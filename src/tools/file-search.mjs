import fs from 'node:fs';
import path from 'node:path';
import { logInfo, logError } from '../logger.mjs';

/**
 * File Search Tool — Deep Inspection Strategy
 * 
 * Provides filesystem search capabilities for the deep-inspect routing strategy.
 * Supports glob patterns, recursive search, and content grep.
 */

const MAX_RESULTS = 100;
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB limit

/**
 * Search files by glob pattern
 * @param {Object} params
 * @param {string} params.pattern - Glob pattern (e.g., "*.mjs")
 * @param {string} [params.root] - Root directory to search from (defaults to workspace)
 * @param {boolean} [params.recursive=true] - Search recursively
 * @returns {Promise<{files: string[], count: number, truncated: boolean}>}
 */
export async function file_search({ pattern, root, recursive = true }) {
  const workspaceRoot = root || process.env.OPENUNUM_WORKSPACE || process.cwd();
  
  logInfo('file_search_invoked', { pattern, root: workspaceRoot, recursive });

  try {
    const files = [];
    const searchDir = path.resolve(workspaceRoot);
    
    // Simple glob implementation (no external deps)
    await searchDirectory(searchDir, pattern, files, recursive, 0);
    
    const truncated = files.length > MAX_RESULTS;
    const resultFiles = truncated ? files.slice(0, MAX_RESULTS) : files;
    
    return {
      files: resultFiles,
      count: files.length,
      truncated,
      root: searchDir,
      pattern
    };
  } catch (error) {
    logError('file_search_failed', { error: String(error.message || error) });
    throw error;
  }
}

/**
 * Search directory recursively
 * @private
 */
async function searchDirectory(dir, pattern, results, recursive, depth) {
  if (depth > 20 || results.length > MAX_RESULTS * 2) {
    return; // Prevent infinite recursion
  }

  try {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      // Skip hidden and common ignore patterns
      if (entry.name.startsWith('.') || 
          entry.name === 'node_modules' || 
          entry.name === '.git' ||
          entry.name === 'dist' ||
          entry.name === 'build') {
        continue;
      }

      const fullPath = path.join(dir, entry.name);
      
      if (entry.isDirectory()) {
        if (recursive) {
          await searchDirectory(fullPath, pattern, results, recursive, depth + 1);
        }
      } else {
        // Match against pattern (simple glob)
        if (matchesPattern(entry.name, pattern) || matchesPattern(fullPath, pattern)) {
          results.push(fullPath);
        }
      }
    }
  } catch (error) {
    // Skip directories we can't read
    if (error.code !== 'EACCES') {
      logError('file_search_dir_error', { dir, error: error.message });
    }
  }
}

/**
 * Simple glob pattern matching
 * @private
 */
function matchesPattern(filename, pattern) {
  // Convert glob to regex
  const regexPattern = pattern
    .replace(/\./g, '\\.')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  
  const regex = new RegExp(`^${regexPattern}$`);
  return regex.test(filename);
}

/**
 * Grep for content in files
 * @param {Object} params
 * @param {string} params.search - Text/pattern to search for
 * @param {string} [params.pattern] - File pattern to filter (e.g., "*.mjs")
 * @param {string} [params.root] - Root directory
 * @param {boolean} [params.caseSensitive=false] - Case-sensitive search
 * @param {number} [params.contextLines=2] - Lines of context around matches
 * @returns {Promise<{matches: Array<{file, line, content, lineNum}>, totalMatches: number}>}
 */
export async function file_grep({ search, pattern, root, caseSensitive = false, contextLines = 2 }) {
  const workspaceRoot = root || process.env.OPENUNUM_WORKSPACE || process.cwd();
  
  logInfo('file_grep_invoked', { search, pattern, root: workspaceRoot });

  try {
    const matches = [];
    const searchDir = path.resolve(workspaceRoot);
    const regex = new RegExp(search, caseSensitive ? '' : 'i');
    
    await grepDirectory(searchDir, pattern, regex, matches, contextLines, 0);
    
    return {
      matches: matches.slice(0, MAX_RESULTS),
      totalMatches: matches.length,
      truncated: matches.length > MAX_RESULTS,
      search,
      pattern: pattern || '**/*'
    };
  } catch (error) {
    logError('file_grep_failed', { error: String(error.message || error) });
    throw error;
  }
}

/**
 * Grep through directory
 * @private
 */
async function grepDirectory(dir, filePattern, regex, matches, contextLines, depth) {
  if (depth > 20 || matches.length > MAX_RESULTS * 2) {
    return;
  }

  try {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      if (entry.name.startsWith('.') || 
          entry.name === 'node_modules' || 
          entry.name === '.git') {
        continue;
      }

      const fullPath = path.join(dir, entry.name);
      
      if (entry.isDirectory()) {
        await grepDirectory(fullPath, filePattern, regex, matches, contextLines, depth + 1);
      } else {
        // Check file pattern
        if (filePattern && !matchesPattern(entry.name, filePattern)) {
          continue;
        }

        // Read and search file
        try {
          const stat = await fs.promises.stat(fullPath);
          if (stat.size > MAX_FILE_SIZE) {
            continue; // Skip large files
          }

          const content = await fs.promises.readFile(fullPath, 'utf-8');
          const lines = content.split('\n');
          
          for (let i = 0; i < lines.length; i++) {
            if (regex.test(lines[i])) {
              matches.push({
                file: fullPath,
                line: lines[i].trim(),
                lineNum: i + 1,
                context: {
                  before: lines.slice(Math.max(0, i - contextLines), i),
                  after: lines.slice(i + 1, Math.min(lines.length, i + 1 + contextLines))
                }
              });
            }
          }
        } catch (readError) {
          // Skip unreadable files
        }
      }
    }
  } catch (error) {
    if (error.code !== 'EACCES') {
      logError('file_grep_dir_error', { dir, error: error.message });
    }
  }
}

/**
 * Get file info (metadata)
 * @param {Object} params
 * @param {string} params.path - File path
 * @returns {Promise<{path, size, created, modified, accessed, isDirectory}>}
 */
export async function file_info({ path: filePath }) {
  const resolvedPath = path.resolve(filePath);
  
  logInfo('file_info_invoked', { path: resolvedPath });

  try {
    const stat = await fs.promises.stat(resolvedPath);
    
    return {
      path: resolvedPath,
      size: stat.size,
      created: stat.birthtime.toISOString(),
      modified: stat.mtime.toISOString(),
      accessed: stat.atime.toISOString(),
      isDirectory: stat.isDirectory(),
      isFile: stat.isFile()
    };
  } catch (error) {
    logError('file_info_failed', { error: String(error.message || error) });
    throw error;
  }
}

/**
 * Tool definitions for runtime registration
 */
export const toolDefinitions = {
  file_search: {
    description: 'Search for files by glob pattern in the workspace',
    parameters: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'Glob pattern (e.g., "*.mjs", "**/*.test.*")'
        },
        root: {
          type: 'string',
          description: 'Root directory (defaults to workspace)'
        },
        recursive: {
          type: 'boolean',
          description: 'Search recursively (default: true)'
        }
      },
      required: ['pattern']
    }
  },
  file_grep: {
    description: 'Search for text content in files',
    parameters: {
      type: 'object',
      properties: {
        search: {
          type: 'string',
          description: 'Text or regex pattern to search for'
        },
        pattern: {
          type: 'string',
          description: 'File pattern to filter (e.g., "*.mjs")'
        },
        root: {
          type: 'string',
          description: 'Root directory (defaults to workspace)'
        },
        caseSensitive: {
          type: 'boolean',
          description: 'Case-sensitive search (default: false)'
        },
        contextLines: {
          type: 'number',
          description: 'Lines of context around matches (default: 2)'
        }
      },
      required: ['search']
    }
  },
  file_info: {
    description: 'Get metadata about a file',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'File path'
        }
      },
      required: ['path']
    }
  }
};

export default {
  file_search,
  file_grep,
  file_info,
  toolDefinitions
};
