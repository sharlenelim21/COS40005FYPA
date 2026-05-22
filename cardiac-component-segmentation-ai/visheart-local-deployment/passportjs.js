"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.isAuthandGuest = exports.isAuthAndNotGuest = exports.isAuthAndAdmin = exports.isAuth = void 0;
const passport_1 = __importDefault(require("passport"));
const passport_local_1 = require("passport-local");
const database_1 = require("./database");
const logger_1 = __importDefault(require("./logger"));
const error_logger_1 = __importDefault(require("../utils/error_logger"));
const serviceLocation = "PassportJS";
const handlePassportError = (error, context) => {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger_1.default.error(`${serviceLocation}: ${context}: ${errorMessage}`);
    (0, error_logger_1.default)(error, serviceLocation, `Error during ${context}.`);
    return error;
};
const configureLocalStrategy = () => {
    passport_1.default.use(new passport_local_1.Strategy((username, password, done) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const result = yield (0, database_1.authenticateUser)(username, password);
            if (!result.success && result.message) {
                logger_1.default.warn(`${serviceLocation}: Failed login attempt - ` +
                    `username=${username} ` +
                    `timestamp=${new Date().toISOString()}`);
                return done(null, false, { message: result.message });
            }
            if (result.success && result.user) {
                return done(null, result.user);
            }
            throw new Error("Authentication failed in an unexpected way.");
        }
        catch (error) {
            return done(handlePassportError(error, "Authentication"));
        }
    })));
};
const configureSessionHandling = () => {
    passport_1.default.serializeUser((user, done) => {
        logger_1.default.info(`${serviceLocation}: Serializing user with ID: ${user._id}`);
        done(null, user._id);
    });
    passport_1.default.deserializeUser((id, done) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const result = yield (0, database_1.readUser)({ _id: id });
            if (!result.success) {
                logger_1.default.warn(`${serviceLocation}: Deserialization failed for user ID: ${id}`);
                return done(null, false);
            }
            if (result.user) {
                logger_1.default.info(`${serviceLocation}: Deserialized user with ID: ${result.user._id}`);
                return done(null, result.user);
            }
            return done(null, false);
        }
        catch (error) {
            return done(handlePassportError(error, "Deserialization"));
        }
    }));
};
configureLocalStrategy();
configureSessionHandling();
const isAuth = (req, res, next) => {
    logger_1.default.info(`${serviceLocation}: Authenticated User: ${req.user ? JSON.stringify(req.user) : 'undefined'}`);
    if (req.isAuthenticated()) {
        return next();
    }
    res.status(401).json({ message: "Unauthorized. Please log in." });
};
exports.isAuth = isAuth;
const isAuthAndAdmin = (req, res, next) => {
    if (req.isAuthenticated() && req.user.role === database_1.UserRole.Admin) {
        return next();
    }
    res.status(403).json({ message: "Forbidden. Admin access required." });
};
exports.isAuthAndAdmin = isAuthAndAdmin;
const isAuthAndNotGuest = (req, res, next) => {
    if (req.isAuthenticated() && req.user.role !== database_1.UserRole.Guest) {
        return next();
    }
    res.status(403).json({ message: "Forbidden. Admin or regular user access required." });
};
exports.isAuthAndNotGuest = isAuthAndNotGuest;
const isAuthandGuest = (req, res, next) => {
    if (req.isAuthenticated() && req.user.role === database_1.UserRole.Guest) {
        return next();
    }
    res.status(403).json({ message: "Forbidden. Only Guest role allowed." });
};
exports.isAuthandGuest = isAuthandGuest;
