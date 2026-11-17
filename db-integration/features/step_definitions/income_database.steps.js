const { Given, When, Then } = require('@cucumber/cucumber');
const assert = require('node:assert/strict');

Given('the income database is available', async function () {
  const result = await this.database.query('SELECT to_regclass($1) AS table_name', [
    'public.incomes',
  ]);
  assert.equal(
    result.rows[0].table_name,
    'incomes',
    'Expected the incomes table; start the backend once to apply its migration',
  );
});

When('I inspect the income database schema', async function () {
  const columns = await this.database.query(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'incomes'`,
  );
  this.columnNames = new Set(columns.rows.map((row) => row.column_name));

  const indexes = await this.database.query(
    `SELECT indexname
     FROM pg_indexes
     WHERE schemaname = 'public' AND tablename = 'incomes'`,
  );
  this.indexNames = new Set(indexes.rows.map((row) => row.indexname));

  const constraints = await this.database.query(
    `SELECT pg_get_constraintdef(constraint_row.oid) AS definition
     FROM pg_constraint AS constraint_row
     JOIN pg_class AS table_row ON table_row.oid = constraint_row.conrelid
     JOIN pg_namespace AS schema_row ON schema_row.oid = table_row.relnamespace
     WHERE schema_row.nspname = 'public' AND table_row.relname = 'incomes'`,
  );
  this.constraintDefinitions = constraints.rows.map((row) => row.definition);
});

Then('the income table has the required columns', function () {
  for (const column of [
    'id',
    'amount_cents',
    'source',
    'category',
    'description',
    'received_on',
    'created_at',
    'updated_at',
  ]) {
    assert.ok(this.columnNames.has(column), `Expected incomes.${column} to exist`);
  }
  assert.ok(
    this.constraintDefinitions.some((definition) => /CHECK\s*\(\(*\s*amount_cents\s*>\s*0\s*\)*\)/i.test(definition)),
    'Expected the database to enforce a positive amount_cents value',
  );
});

Then('the income table has the expected lookup indexes', function () {
  assert.ok(this.indexNames.has('incomes_received_on_idx'));
  assert.ok(this.indexNames.has('incomes_category_idx'));
});

When(
  'I insert a {string} income of {int} cents in category {string} received on {string}',
  async function (alias, amountCents, category, receivedOn) {
    const source = this.sourceFor(alias);
    const result = await this.database.query(
      `INSERT INTO incomes (id, amount_cents, source, category, description, received_on)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5)
       RETURNING id`,
      [amountCents, source, category, 'BDD database integration test', receivedOn],
    );
    this.incomeIds.set(alias, result.rows[0].id);
    this.incomeData.set(alias, {
      amountCents,
      category,
      description: 'BDD database integration test',
      receivedOn,
    });
  },
);

Then(
  'the {string} income is persisted with its submitted values',
  async function (alias) {
    const result = await this.database.query(
      `SELECT amount_cents, source, category, description, received_on::text AS received_on
       FROM incomes WHERE id = $1`,
      [this.incomeIds.get(alias)],
    );
    const expected = this.incomeData.get(alias);
    assert.equal(result.rowCount, 1);
    assert.equal(Number(result.rows[0].amount_cents), expected.amountCents);
    assert.equal(result.rows[0].source, this.sourceFor(alias));
    assert.equal(result.rows[0].category, expected.category);
    assert.equal(result.rows[0].description, expected.description);
    assert.equal(result.rows[0].received_on, expected.receivedOn);
  },
);

When(
  'I update the {string} income to {int} cents and category {string}',
  async function (alias, amountCents, category) {
    await this.database.query(
      `UPDATE incomes
       SET amount_cents = $2, category = $3, updated_at = NOW()
       WHERE id = $1`,
      [this.incomeIds.get(alias), amountCents, category],
    );
    const expected = this.incomeData.get(alias);
    this.incomeData.set(alias, { ...expected, amountCents, category });
  },
);

Then(
  'the {string} income is persisted with the updated values',
  async function (alias) {
    const result = await this.database.query(
      'SELECT amount_cents, category FROM incomes WHERE id = $1',
      [this.incomeIds.get(alias)],
    );
    const expected = this.incomeData.get(alias);
    assert.equal(result.rowCount, 1);
    assert.equal(Number(result.rows[0].amount_cents), expected.amountCents);
    assert.equal(result.rows[0].category, expected.category);
  },
);

When('I delete the {string} income', async function (alias) {
  await this.database.query('DELETE FROM incomes WHERE id = $1', [
    this.incomeIds.get(alias),
  ]);
});

Then('the {string} income no longer exists', async function (alias) {
  const result = await this.database.query('SELECT 1 FROM incomes WHERE id = $1', [
    this.incomeIds.get(alias),
  ]);
  assert.equal(result.rowCount, 0);
});

When(
  'I attempt to insert a {string} income of {int} cents',
  async function (alias, amountCents) {
    try {
      await this.database.query(
        `INSERT INTO incomes (id, amount_cents, source, category, received_on)
         VALUES (gen_random_uuid(), $1, $2, 'Other', CURRENT_DATE)`,
        [amountCents, this.sourceFor(alias)],
      );
      this.insertError = undefined;
    } catch (error) {
      this.insertError = error;
    }
  },
);

Then('the database rejects the income because its amount must be positive', function () {
  assert.ok(this.insertError, 'Expected the insert to fail');
  assert.equal(this.insertError.code, '23514');
  assert.equal(this.insertError.constraint, 'incomes_amount_cents_check');
});

Then('the {string} income was not persisted', async function (alias) {
  const result = await this.database.query('SELECT 1 FROM incomes WHERE source = $1', [
    this.sourceFor(alias),
  ]);
  assert.equal(result.rowCount, 0);
});
