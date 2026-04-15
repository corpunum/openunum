# UnumCouncil Voting Rules

## Threshold
- Default: 60% approval (3 out of 5 models)
- Configurable per request via `threshold` argument

## What Gets Voted On
1. **Actions** - Any proposed command, file change, or tool call
2. **Claims** - Factual assertions that affect decisions
3. **Plans** - Multi-step workflows or strategies

## Voting Process
1. Consolidator presents each item clearly
2. Each council member votes YES/NO with brief reason
3. Items meeting threshold are approved
4. Approved items form final output

## Tie-Breaking
- Default model (strongest) has tie-breaking vote if needed
- 2-2 split with 1 abstention → default model decides

## Veto Power
- No individual veto; majority rules
- Safety-critical items require 80% (4/5) approval
