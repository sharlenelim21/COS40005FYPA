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
    .matches(/^\d{10,15}$/)
    .withMessage('Phone number must be between 10 and 15 digits.')
];

export default validateFields;