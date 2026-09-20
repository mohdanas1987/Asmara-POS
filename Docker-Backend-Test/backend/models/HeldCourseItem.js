'use strict';
const TenantModel = require('./TenantModel');

// Course firing (CTO forensic audit 2026-09-20, task "Courses"). One row per (order, course)
// batch of items deliberately held back from the kitchen until a waiter fires that course --
// see services/courseRouting.js for the actual hold/fire logic.
class HeldCourseItem extends TenantModel {
  static get tableName() {
    return 'held_course_items';
  }
}

module.exports = HeldCourseItem;
