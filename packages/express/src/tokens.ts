/**
 * Service tokens for dependency injection.
 *
 * These tokens identify services in the ServiceContainer.
 */
export const ServiceTokens = {
  // Core services
  ExecutionEngine: Symbol.for('fm:ExecutionEngine'),
  FlowRegistry: Symbol.for('fm:FlowRegistry'),
  HandlerRegistry: Symbol.for('fm:HandlerRegistry'),
  EventBus: Symbol.for('fm:EventBus'),

  // Storage
  StateStore: Symbol.for('fm:StateStore'),
  ContextStorage: Symbol.for('fm:ContextStorage'),
  JobStore: Symbol.for('fm:JobStore'),
  EventStore: Symbol.for('fm:EventStore'),

  // Token management
  ResumeTokenManager: Symbol.for('fm:ResumeTokenManager'),

  // Vault
  VaultProvider: Symbol.for('fm:VaultProvider'),

  // Jobs
  JobRunner: Symbol.for('fm:JobRunner'),

  // Database
  DatabasePool: Symbol.for('fm:DatabasePool'),

  // Express
  ExpressApp: Symbol.for('fm:ExpressApp'),

  // DataStore — Tables
  TableRegistry: Symbol.for('fm:TableRegistry'),
  TableStore: Symbol.for('fm:TableStore'),
  PoolProvider: Symbol.for('fm:PoolProvider'),
  WriteAheadLog: Symbol.for('fm:WriteAheadLog'),
  DDLProvider: Symbol.for('fm:DDLProvider'),
} as const;

export type ServiceToken = (typeof ServiceTokens)[keyof typeof ServiceTokens];
