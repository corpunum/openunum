import { WorkerOrchestrator } from './worker-orchestrator.mjs';
import { SelfEditPipeline } from './self-edit-pipeline.mjs';
import { ModelScoutWorkflow } from './model-scout-workflow.mjs';
import { TaskOrchestrator } from './task-orchestrator.mjs';
import { GoalTaskPlanner } from './goal-task-planner.mjs';
import { DaemonManager } from './daemon-manager.mjs';

let workerOrchestrator = null;
let selfEditPipeline = null;
let modelScoutWorkflow = null;
let taskOrchestrator = null;
let goalTaskPlanner = null;
let daemonManager = null;

function syncWorkerOrchestrator(ctx) {
  if (!workerOrchestrator) {
    workerOrchestrator = new WorkerOrchestrator({ toolRuntime: ctx.agent.toolRuntime, memoryStore: ctx.memory });
  }
  workerOrchestrator.toolRuntime = ctx.agent.toolRuntime;
  workerOrchestrator.memoryStore = ctx.memory;
  return workerOrchestrator;
}

function syncSelfEditPipeline(ctx) {
  if (!selfEditPipeline) {
    selfEditPipeline = new SelfEditPipeline({
      toolRuntime: ctx.agent.toolRuntime,
      memoryStore: ctx.memory,
      workspaceRoot: ctx.config.runtime?.workspaceRoot || process.cwd(),
      defaultBaseUrl: `http://127.0.0.1:${ctx.config.server?.port || 18880}`,
      runtimeConfig: ctx.config.runtime
    });
  }
  selfEditPipeline.toolRuntime = ctx.agent.toolRuntime;
  selfEditPipeline.memoryStore = ctx.memory;
  selfEditPipeline.workspaceRoot = ctx.config.runtime?.workspaceRoot || process.cwd();
  selfEditPipeline.defaultBaseUrl = `http://127.0.0.1:${ctx.config.server?.port || 18880}`;
  selfEditPipeline.runtimeConfig = ctx.config.runtime || {};
  return selfEditPipeline;
}

function syncModelScoutWorkflow(ctx) {
  if (!modelScoutWorkflow) {
    modelScoutWorkflow = new ModelScoutWorkflow({
      toolRuntime: ctx.agent.toolRuntime,
      memoryStore: ctx.memory,
      workspaceRoot: ctx.config.runtime?.workspaceRoot || process.cwd(),
      ollamaBaseUrl: ctx.config.model?.ollamaBaseUrl || 'http://127.0.0.1:11434'
    });
  }
  modelScoutWorkflow.toolRuntime = ctx.agent.toolRuntime;
  modelScoutWorkflow.memoryStore = ctx.memory;
  modelScoutWorkflow.workspaceRoot = ctx.config.runtime?.workspaceRoot || process.cwd();
  modelScoutWorkflow.ollamaBaseUrl = ctx.config.model?.ollamaBaseUrl || 'http://127.0.0.1:11434';
  return modelScoutWorkflow;
}

function syncTaskOrchestrator(ctx) {
  if (!taskOrchestrator) {
    taskOrchestrator = new TaskOrchestrator({
      toolRuntime: ctx.agent.toolRuntime,
      memoryStore: ctx.memory,
      missions: ctx.missions,
      workerOrchestrator: syncWorkerOrchestrator(ctx),
      selfEditPipeline: syncSelfEditPipeline(ctx),
      modelScoutWorkflow: syncModelScoutWorkflow(ctx),
      planner: syncGoalTaskPlanner(ctx),
      workspaceRoot: ctx.config.runtime?.workspaceRoot || process.cwd()
    });
  }
  taskOrchestrator.toolRuntime = ctx.agent.toolRuntime;
  taskOrchestrator.memoryStore = ctx.memory;
  taskOrchestrator.missions = ctx.missions;
  taskOrchestrator.workerOrchestrator = syncWorkerOrchestrator(ctx);
  taskOrchestrator.selfEditPipeline = syncSelfEditPipeline(ctx);
  taskOrchestrator.modelScoutWorkflow = syncModelScoutWorkflow(ctx);
  taskOrchestrator.planner = syncGoalTaskPlanner(ctx);
  taskOrchestrator.workspaceRoot = ctx.config.runtime?.workspaceRoot || process.cwd();
  return taskOrchestrator;
}

function syncGoalTaskPlanner(ctx) {
  if (!goalTaskPlanner) {
    goalTaskPlanner = new GoalTaskPlanner({
      runtime: ctx.config.runtime,
      baseUrl: `http://127.0.0.1:${ctx.config.server?.port || 18880}`,
      workspaceRoot: ctx.config.runtime?.workspaceRoot || process.cwd()
    });
  }
  goalTaskPlanner.runtime = ctx.config.runtime;
  goalTaskPlanner.baseUrl = `http://127.0.0.1:${ctx.config.server?.port || 18880}`;
  goalTaskPlanner.workspaceRoot = ctx.config.runtime?.workspaceRoot || process.cwd();
  return goalTaskPlanner;
}

export function getWorkerOrchestrator(ctx) {
  return syncWorkerOrchestrator(ctx);
}

export function getSelfEditPipeline(ctx) {
  return syncSelfEditPipeline(ctx);
}

export function getModelScoutWorkflow(ctx) {
  return syncModelScoutWorkflow(ctx);
}

export function getTaskOrchestrator(ctx) {
  return syncTaskOrchestrator(ctx);
}

export function getGoalTaskPlanner(ctx) {
  return syncGoalTaskPlanner(ctx);
}

function syncDaemonManager(ctx) {
  if (!daemonManager) {
    daemonManager = new DaemonManager({
      toolRuntime: ctx.agent.toolRuntime,
      memoryStore: ctx.memory,
      workspaceRoot: ctx.config.runtime?.workspaceRoot || process.cwd()
    });
    daemonManager.startHealthLoop();
  }
  daemonManager.toolRuntime = ctx.agent.toolRuntime;
  daemonManager.memoryStore = ctx.memory;
  daemonManager.workspaceRoot = ctx.config.runtime?.workspaceRoot || process.cwd();
  return daemonManager;
}

export function getDaemonManager(ctx) {
  return syncDaemonManager(ctx);
}
