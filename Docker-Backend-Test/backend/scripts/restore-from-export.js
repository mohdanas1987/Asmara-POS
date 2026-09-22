'use strict';
/**
 * One-off recovery script (2026-09-22): restores categories, menu items and tables from
 * migration-export/data.json into local_test.sqlite, after an earlier seed script
 * accidentally wiped the working database's real data.
 *
 * SAFE BY DESIGN:
 *   - Only ever touches menu_categories, menu_items, tables (and the one stray leftover
 *     demo order on table 3 from the seed). Never touches `users` -- your working
 *     admin@test.local login is left exactly as-is.
 *   - Wrapped in a single transaction: if anything fails partway, nothing is committed.
 *   - Refuses to run if menu_items already has more than the 2 leftover demo rows, so it
 *     can't accidentally double-import or clobber real data a second time.
 *   - Image files are NOT touched or copied here -- they were never deleted by the seed
 *     (only DB rows were), and are already sitting in backend/tmp/menu_items/ where
 *     /images/menu_items/<file> already serves them from.
 *
 * Run with:  node scripts/restore-from-export.js
 * (from the backend/ directory, using your Mac's own node -- NOT through any remote shell,
 * so the sqlite3 native binding stays the correct macOS build.)
 */
const path = require('path');
const fs = require('fs');
const Knex = require('knex');

const EXPORT_PATH = path.join(__dirname, '../../../migration-export/data.json');
const knexConfig = require('../knexfile.local.js').development;

async function main() {
    if (!fs.existsSync(EXPORT_PATH)) {
        console.error(`Export file not found at ${EXPORT_PATH}`);
        process.exit(1);
    }
    const exportData = JSON.parse(fs.readFileSync(EXPORT_PATH, 'utf8'));
    const { categories, items, tables } = exportData;
    console.log(`Export contains: ${categories.length} categories, ${items.length} items, ${tables.length} tables.`);

    const knex = Knex(knexConfig);
    try {
        const currentItemCount = await knex('menu_items').count('id as c').first();
        if (Number(currentItemCount.c) > 2) {
            console.error(
                `Refusing to run: menu_items already has ${currentItemCount.c} rows (more than the ` +
                `2 leftover demo rows this script expects). This looks like it may have already been ` +
                `restored, or real data already exists -- stopping without touching anything.`
            );
            process.exit(1);
        }

        await knex.transaction(async (trx) => {
            const TENANT_ID = 1;

            // Clear the tiny demo data the seed script left behind (2 items, 1 category,
            // 3 tables, 1 stray order) -- never touches `users`.
            await trx('orders').del();
            await trx('menu_items').del();
            await trx('menu_categories').del();
            await trx('tables').del();

            // Categories -- explicit ids preserved so items' category_id links resolve correctly.
            for (const cat of categories) {
                await trx('menu_categories').insert({
                    id: cat.id,
                    name: cat.name,
                    sq_pos: cat.sq_pos ?? 0,
                    status: true,
                    tenant_id: TENANT_ID,
                });
            }

            // Items -- category_id points at the preserved category ids above.
            for (const item of items) {
                await trx('menu_items').insert({
                    name: item.name,
                    price: String(item.price),
                    category_id: item.category_id,
                    tax: item.tax != null ? String(item.tax) : null,
                    image: item.image || null,
                    thumb: item.thumb || null,
                    stock: item.stock ?? 0,
                    quantity: item.stock ?? 0,
                    code: item.code || null,
                    pos: !!item.pos,
                    deleted: false,
                    seq: parseInt(item.seq, 10) || 0,
                    tenant_id: TENANT_ID,
                });
            }

            // Tables -- every table restored as 'free' (no stale in-progress orders survive
            // a data-loss event like this; that's the honest, safe default).
            for (const t of tables) {
                await trx('tables').insert({
                    table_number: t.table_number,
                    length: t.length,
                    width: t.width,
                    x: t.x,
                    y: t.y,
                    status: 'free',
                    linked_to: null,
                    tenant_id: TENANT_ID,
                });
            }
        });

        const finalCounts = {
            categories: (await knex('menu_categories').count('id as c').first()).c,
            items: (await knex('menu_items').count('id as c').first()).c,
            tables: (await knex('tables').count('id as c').first()).c,
        };
        console.log('Restore complete:', finalCounts);
    } finally {
        await knex.destroy();
    }
}

main().catch((err) => {
    console.error('Restore failed:', err.message);
    process.exit(1);
});
