'use strict';
/**
 * Course firing (CTO forensic audit 2026-09-20, task "Courses" -- flagged as never built,
 * correctly). Sits BETWEEN the existing order flow (routes/orders.js) and the existing
 * per-station kitchen routing (services/kitchenRouting.js): every item that goes to the
 * kitchen passes through here first. An item with no `course` set on its menu_items row
 * (i.e. every item in this app before today, and every item any existing test creates)
 * fires immediately exactly as before -- this only changes behavior for an item that has
 * deliberately been assigned a later course (Preservation Contract).
 *
 * 'starter' (or no course) fires immediately. Any other course value ('main', 'dessert',
 * 'other', or a tenant's own custom label) is held in held_course_items until a waiter
 * explicitly fires it via POST /kitchen/fire-course.
 */
const Item = require('../models/Item');
const Order = require('../models/Order');
const HeldCourseItem = require('../models/HeldCourseItem');
const { routeOrderToKitchen } = require('./kitchenRouting');

const IMMEDIATE_COURSES = new Set([null, undefined, '', 'starter']);

/**
 * @param {object} params
 * @param {number} params.tenantId
 * @param {string} params.orderId
 * @param {string|null} params.tableNumber
 * @param {Array<{id: number|string, quantity: number}>} params.items
 * @returns {Promise<Array>} kitchen_tickets rows created for the items fired immediately
 */
async function sendItemsRespectingCourses({ tenantId, orderId, tableNumber, items }) {
  if (!items || items.length === 0) return [];

  const itemIds = items.map((i) => i.id).filter((id) => id !== undefined && id !== null);
  const menuItems = itemIds.length
    ? await Item.forTenant(tenantId).whereIn('id', itemIds).select('id', 'course')
    : [];
  const courseByItemId = new Map(menuItems.map((mi) => [String(mi.id), mi.course || null]));

  const immediate = [];
  const heldByCourse = new Map();
  for (const item of items) {
    const course = courseByItemId.get(String(item.id)) ?? null;
    if (IMMEDIATE_COURSES.has(course)) {
      immediate.push(item);
    } else {
      if (!heldByCourse.has(course)) heldByCourse.set(course, []);
      heldByCourse.get(course).push(item);
    }
  }

  const tickets = immediate.length
    ? await routeOrderToKitchen({ tenantId, orderId, tableNumber, items: immediate })
    : [];

  for (const [course, courseItems] of heldByCourse.entries()) {
    // eslint-disable-next-line no-await-in-loop
    await HeldCourseItem.query().insert({
      tenant_id: tenantId,
      order_id: orderId,
      table_number: tableNumber ?? null,
      course,
      items: JSON.stringify(courseItems),
    });
  }

  return tickets;
}

/** Everything still held (not yet fired) for one order, grouped by course. */
async function getHeldCourses({ tenantId, orderId }) {
  const held = await HeldCourseItem.forTenant(tenantId)
    .where('order_id', orderId)
    .whereNull('fired_at')
    .orderBy('created_at', 'asc');

  const byCourse = new Map();
  for (const row of held) {
    if (!byCourse.has(row.course)) byCourse.set(row.course, { course: row.course, items: [], rowIds: [] });
    const bucket = byCourse.get(row.course);
    bucket.items.push(...JSON.parse(row.items));
    bucket.rowIds.push(row.id);
  }
  return Array.from(byCourse.values());
}

/** Fires every held item of one course for one order into real kitchen tickets. */
async function fireCourse({ tenantId, orderId, course }) {
  const held = await HeldCourseItem.forTenant(tenantId)
    .where('order_id', orderId)
    .where('course', course)
    .whereNull('fired_at');

  if (held.length === 0) return { tickets: [], firedItemCount: 0 };

  const allItems = held.flatMap((row) => JSON.parse(row.items));
  const order = await Order.query().findById(orderId).where('tenant_id', tenantId);

  const tickets = await routeOrderToKitchen({
    tenantId,
    orderId,
    tableNumber: order ? order.tables : null,
    items: allItems,
  });

  await HeldCourseItem.query()
    .whereIn('id', held.map((row) => row.id))
    .patch({ fired_at: new Date().toISOString() });

  return { tickets, firedItemCount: allItems.length };
}

module.exports = { sendItemsRespectingCourses, getHeldCourses, fireCourse };
