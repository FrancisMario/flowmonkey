/**
 * Example 09 — Pipes & DataStore
 *
 * Demonstrates:
 * - Defining tables with typed columns
 * - Attaching pipes to step outputs
 * - Automatic data routing — step completes → row inserted
 * - Querying stored rows
 * - WAL (write-ahead log) for failed inserts
 */

import {
  Engine,
  MemoryStore,
  DefaultHandlerRegistry,
  DefaultFlowRegistry,
  MemoryTableRegistry,
  MemoryTableStore,
  MemoryWAL,
  EventDispatcher,
  Result,
  type Flow,
  type StepHandler,
  type TableDef,
} from '@flowmonkey/core';

// ── Handlers ────────────────────────────────────────────────────

const processOrderHandler: StepHandler = {
  type: 'process-order',
  async execute({ input }) {
    const order = input as Record<string, unknown>;
    return Result.success({
      orderId: order.id,
      total: (order.qty as number) * (order.price as number),
      status: 'confirmed',
      processedAt: new Date().toISOString(),
    });
  },
};

// ── Table definition ────────────────────────────────────────────
//
// Tables are dynamic, user-created schemas with typed columns.
// Think of them as lightweight data stores for workflow outputs.

const ordersTable: TableDef = {
  id: 'orders-table',
  columns: [
    { id: 'order_id',     name: 'Order ID',     type: 'string',   required: true },
    { id: 'total',        name: 'Total',         type: 'number',   required: true },
    { id: 'status',       name: 'Status',        type: 'string',   required: true },
    { id: 'processed_at', name: 'Processed At',  type: 'datetime', required: false },
  ],
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

// ── Flow with a pipe ────────────────────────────────────────────
//
// A pipe is a "silent tap" on a step's output that inserts data
// into a table. The flow doesn't need to know about it — pipes
// are fire-and-forget and never affect execution.

const orderFlow: Flow = {
  id: 'order-pipeline',
  version: '1.0.0',
  initialStepId: 'process',
  steps: {
    process: {
      id: 'process',
      type: 'process-order',
      config: {},
      input: { type: 'full' },
      outputKey: 'result',
      transitions: { onSuccess: null },
    },
  },
  // Pipes: route step outputs to tables
  pipes: [
    {
      id: 'pipe-orders',
      stepId: 'process',        // tap this step's output
      on: 'success',            // only on success
      tableId: 'orders-table',  // insert into this table
      mappings: [
        { sourcePath: 'orderId',     columnId: 'order_id' },
        { sourcePath: 'total',       columnId: 'total' },
        { sourcePath: 'status',      columnId: 'status' },
        { sourcePath: 'processedAt', columnId: 'processed_at' },
      ],
    },
  ],
};

// ── Run ─────────────────────────────────────────────────────────

async function main() {
  const store = new MemoryStore();
  const handlers = new DefaultHandlerRegistry();
  const flows = new DefaultFlowRegistry();
  const tableRegistry = new MemoryTableRegistry();
  const tableStore = new MemoryTableStore();
  const wal = new MemoryWAL();
  const dispatcher = new EventDispatcher({ mode: 'sync' });

  handlers.register(processOrderHandler);
  flows.register(orderFlow);

  // Register the table definition
  await tableRegistry.create(ordersTable);

  // Listen for pipe events
  dispatcher.on('pipe.inserted', (e) => {
    console.log(`  📊 Pipe inserted: row in table "${e.tableId}"`);
  });

  // Engine with table support enabled
  const engine = new Engine(store, handlers, flows, dispatcher, {
    tableStore,
    tableRegistry,
    pipeWAL: wal,
  });

  // Process a few orders
  console.log('--- Processing orders ---');
  for (const order of [
    { id: 'ORD-001', qty: 3, price: 29.99 },
    { id: 'ORD-002', qty: 1, price: 149.99 },
    { id: 'ORD-003', qty: 10, price: 4.99 },
  ]) {
    const { execution } = await engine.create('order-pipeline', order);
    await engine.run(execution.id, { simulateTime: true });
    const final = await engine.get(execution.id);
    console.log(`  Order ${order.id}: ${final?.status}, total $${(final?.context.result as any)?.total}`);
  }

  // Query the table — rows were inserted automatically by the pipe
  console.log('\n--- Querying orders table ---');
  const { rows, total } = await tableStore.query({
    tableId: 'orders-table',
  });

  console.log(`  Found ${total} rows:`);
  for (const row of rows) {
    console.log(`    ${row.order_id} — $${row.total} (${row.status})`);
  }

  // Check WAL (should be empty — all inserts succeeded)
  const pending = await wal.readPending();
  console.log(`\n  WAL pending entries: ${pending.length}`);
}

main().catch(console.error);
