/**
 * Same import used for the Windows machine, adapted for the Mac's local test database.
 * Imports the real menu categories, items, and tables from migration-export/data.json,
 * and copies the real menu photos + logo into this backend's own tmp/ folder.
 *
 * Run from inside this backend folder (stop `node server.local.js` first -- SQLite dislikes
 * concurrent writers):
 *   node import-migrated-data.js ./local_test.sqlite
 */
const fs = require('fs');
const path = require('path');
const Knex = require('knex');

const dbPath = process.argv[2];
if (!dbPath) {
  console.error('Usage: node import-migrated-data.js <path-to-sqlite-file>');
  process.exit(1);
}
if (!fs.existsSync(dbPath)) {
  console.error(`No such file: ${dbPath}`);
  process.exit(1);
}

const EXPORT_DIR = path.join(__dirname, '..', '..', 'migration-export');
const data = JSON.parse(fs.readFileSync(path.join(EXPORT_DIR, 'data.json'), 'utf8'));

const knex = Knex({
  client: 'sqlite3',
  connection: { filename: dbPath },
  useNullAsDefault: true,
});

async function main() {
  const existing = await knex('menu_categories').count('id as c').first();
  if (Number(existing.c) > 0) {
    throw new Error(
      `menu_categories already has ${existing.c} row(s) -- refusing to import again to avoid ` +
      `duplicates/conflicts. If you really want to re-run this, clear menu_categories, menu_items, ` +
      `and tables first.`
    );
  }

  const users = await knex('users').select('id', 'email', 'tenant_id');
  if (users.length !== 1) {
    console.log('Users found:', users);
    throw new Error(`Expected exactly 1 user (your test admin account), found ${users.length}.`);
  }
  const tenantId = users[0].tenant_id;
  console.log(`Using tenant_id=${tenantId} (${users[0].email})`);

  await knex.transaction(async (trx) => {
    for (const cat of data.categories) {
      await trx('menu_categories').insert({
        id: cat.id,
        name: cat.name,
        color: '#1f1d1d',
        status: true,
        sq_pos: cat.sq_pos || 0,
        tenant_id: tenantId,
      });
    }
    console.log(`Inserted ${data.categories.length} categories.`);

    await trx('taxes').insert({ name: 'BTW 9%', amount: '9', status: true, tenant_id: tenantId });

    let itemsInserted = 0;
    for (const item of data.items) {
      await trx('menu_items').insert({
        id: item.id,
        name: item.name,
        image: item.image || null,
        thumb: item.thumb || null,
        category_id: item.category_id,
        price: item.price,
        code: null,
        tax: item.tax || '0',
        stock: item.stock || 0,
        quantity: item.stock || 0,
        pos: !!item.pos,
        deleted: false,
        added_by: null,
        sales_desc: item.description || null,
        seq: parseInt(item.seq, 10) || 0,
        tenant_id: tenantId,
      });
      itemsInserted++;
    }
    console.log(`Inserted ${itemsInserted} menu items.`);

    for (const t of data.tables) {
      await trx('tables').insert({
        id: t.id,
        table_number: t.table_number,
        length: t.length,
        width: t.width,
        x: t.x,
        y: t.y,
        status: 'free',
        linked_to: t.linked_to || null,
        tenant_id: tenantId,
      });
    }
    console.log(`Inserted ${data.tables.length} tables.`);
  });

  const srcTmp = path.join(EXPORT_DIR, 'tmp');
  const destTmp = path.join(__dirname, 'tmp');
  if (fs.existsSync(srcTmp)) {
    fs.cpSync(srcTmp, destTmp, { recursive: true });
    console.log('Copied menu item images into tmp/.');
  }
  const srcLogo = path.join(EXPORT_DIR, 'branding', 'logo-bw.png');
  if (fs.existsSync(srcLogo)) {
    fs.copyFileSync(srcLogo, path.join(destTmp, 'logo-bw.png'));
    console.log('Copied logo-bw.png into tmp/.');
  }

  console.log('\nDone. Restart node server.local.js -- your real menu, categories, and tables should now show up.');
  await knex.destroy();
}

main().catch((err) => {
  console.error('Import failed:', err.message);
  process.exit(1);
});
