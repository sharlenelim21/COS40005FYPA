import { body, ValidationChain } from 'express-validator';

const validateFields: ValidationChain[] = [
  body('username')
    .isLength({ min: 3, max: 20 })
    .withMessage('Username must be between 3 and 20 characters.')
    .matches(/^[a-zA-Z0-9_]+$/)
    .withMessage('Username can only contain letters, numbers, and underscores.'),
  body('password')
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters long.')
    .matches(/[A-Z]/)
    .withMessage('Password must contain at least one uppercase letter.')
    .matches(/[a-z]/)
    .withMessage('Password must contain at least one lowercase letter.')
    .matches(/[0-9]/)
    .withMessage('Password must contain at least one number.')
    .matches(/[@$!%*?&]/)
    .withMessage('Password must contain at least one special character (@, $, !, %, *, ?, &).'),
  body('email')
    .isEmail()
    .withMessage('A valid email address is required.'),
  body('phone')
    // Accepts Malaysian formats with optional spaces/dashes (e.g. "012-345 6789",
    // "+60123456789", "0123456789"), normalises to digits-with-optional-leading-+ before
    // matching: +60/60/0 prefix, then a mobile/landline area digit, then 6-8 more digits.
    .customSanitizer((value: string) => (typeof value === 'string' ? value.replace(/[\s-]/g, '') : value))
    .matches(/^(?:\+?60|0)\d{8,10}$/)
    .withMessage('Enter a valid Malaysian phone number, e.g. 012-345 6789 or +60123456789.')
];

export default validateFields;