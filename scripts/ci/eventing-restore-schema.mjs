import assert from 'node:assert/strict';

const VIEW = 'atlas_restore_expression_probe';

// Catalog-generated expressions from the fixed CI database only; never arbitrary input.
// Reparse with PostgreSQL itself instead of stripping casts, literals or parentheses.
export async function reparseBooleanExpression(connection, table, expression) {
  assert.match(table, /^[a-z][a-z0-9_]*$/u);
  assert.equal(typeof expression, 'string');
  assert.ok(expression.length > 0);
  await connection.query(`CREATE OR REPLACE TEMP VIEW ${VIEW} AS
    SELECT (${expression}) AS expression FROM public."${table}"`);
  const read = async () => {
    const [row] = await connection.query(
      `SELECT pg_get_viewdef('pg_temp.${VIEW}'::regclass, false) AS definition`,
    );
    assert.equal(typeof row.definition, 'string');
    return row.definition;
  };
  const first = await read();
  await connection.query(`CREATE OR REPLACE TEMP VIEW ${VIEW} AS ${first}`);
  const second = await read();
  assert.equal(first, second, 'PostgreSQL expression reconstruction must reach a fixed point.');
  return second;
}

export async function canonicalizeSchema(database, state) {
  const connection = database.createQueryRunner();
  await connection.connect();
  try {
    await connection.startTransaction();
    try {
      for (const row of state.constraints) {
        if (row.contype !== 'c') continue;
        const [catalog] = await connection.query(
          `SELECT pg_get_expr(conbin,conrelid,false) AS expression
          FROM pg_constraint WHERE conname=$1 AND conrelid=$2::regclass`,
          [row.conname, `public.${row.relation}`],
        );
        const prefix = `CHECK (${catalog.expression})`;
        assert.ok(row.definition.startsWith(prefix), 'Unexpected CHECK reconstruction.');
        const suffix = row.definition.slice(prefix.length);
        row.definition = `CHECK (${await reparseBooleanExpression(
          connection,
          row.relation,
          catalog.expression,
        )})${suffix}`;
      }
      for (const row of state.indexes) {
        const [catalog] = await connection.query(
          `SELECT pg_get_expr(indpred,indrelid,false) AS expression FROM pg_index
          WHERE indexrelid=$1::regclass`,
          [`public.${row.indexname}`],
        );
        if (catalog.expression === null) continue;
        const suffix = ` WHERE ${catalog.expression}`;
        assert.ok(row.indexdef.endsWith(suffix), 'Unexpected partial index reconstruction.');
        row.indexdef = `${row.indexdef.slice(0, -suffix.length)} WHERE ${await reparseBooleanExpression(
          connection,
          row.tablename,
          catalog.expression,
        )}`;
      }
      return state;
    } finally {
      await connection.rollbackTransaction();
    }
  } finally {
    await connection.release();
  }
}

export async function verifySchemaOracle(database) {
  const connection = database.createQueryRunner();
  await connection.connect();
  try {
    await connection.startTransaction();
    try {
      const before = await reparseBooleanExpression(
        connection,
        'admin_accounts',
        "(status)::text = ANY ((ARRAY['active'::character varying, 'disabled'::character varying])::text[])",
      );
      const after = await reparseBooleanExpression(
        connection,
        'admin_accounts',
        "(status)::text = ANY (ARRAY[('active'::character varying)::text, ('disabled'::character varying)::text])",
      );
      assert.equal(before, after, 'Equivalent parser representations must agree.');
      const changedLiteral = await reparseBooleanExpression(
        connection,
        'admin_accounts',
        "(status)::text = ANY ((ARRAY['active'::character varying, 'changed'::character varying])::text[])",
      );
      const changedOperator = await reparseBooleanExpression(
        connection,
        'admin_accounts',
        "(status)::text <> ALL ((ARRAY['active'::character varying, 'disabled'::character varying])::text[])",
      );
      assert.notEqual(before, changedLiteral, 'A changed allowed value must remain detectable.');
      assert.notEqual(before, changedOperator, 'A changed operator must remain detectable.');
    } finally {
      await connection.rollbackTransaction();
    }
  } finally {
    await connection.release();
  }
}
