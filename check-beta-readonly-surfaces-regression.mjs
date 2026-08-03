#!/usr/bin/env node
import assert from 'node:assert/strict';
import { classifyRouteResponse, expectedProtected401Routes } from './check-beta-readonly-surfaces.mjs';

assert(expectedProtected401Routes.has('/admin.html'), 'admin.html must be explicitly listed as protected');
assert.equal(classifyRouteResponse('/admin.html', 401, 'Unauthorized').ok, true, 'expected protected 401 should pass');
assert.equal(classifyRouteResponse('/admin.html', 200, '<html>admin</html>').ok, false, 'unexpected protected 200 must fail');
assert.equal(classifyRouteResponse('/admin.html', 302, '').ok, false, 'protected redirect leakage must fail');
assert.equal(classifyRouteResponse('/admin.html', 403, '').ok, false, 'unexpected protected 403 must fail');
assert.equal(classifyRouteResponse('/admin.html', 404, '').ok, false, 'unexpected protected 404 must fail');
assert.equal(classifyRouteResponse('/admin.html', 500, '').ok, false, 'unexpected protected 500 must fail');
assert.equal(classifyRouteResponse('/drinks.html', 401, 'Unauthorized').ok, false, 'non-protected 401 must fail');
assert.equal(classifyRouteResponse('/drinks.html', 200, '<html>ok</html>').ok, true, 'ordinary public 200 should pass');

console.log('Beta read-only protected-route regression ok.');
