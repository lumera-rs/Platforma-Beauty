import { validatePackage } from '../validate.mjs';
import { runAuditedSuite } from './validation-fixtures.mjs';

const result = runAuditedSuite(validatePackage);
console.log(`validation.test.mjs: baseline valid; ${result.negativeTests} negative fixtures rejected with exact errors; every mutation observed.`);