import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local"; // for username and pw authentication
import { readUser, authenticateUser, IUserSafe, UserRole } from "./database"; // Import the User model 
import logger from "./logger"; // Import the logger 
import LogError from "../utils/error_logger";
import { Request, Response, NextFunction } from 'express';

const serviceLocation = "PassportJS"; // Location of the service for logging purposes

declare global {
  // Disable the namespace rule just for this block
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    // Disable the empty object type rule for this necessary augmentation
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface User extends IUserSafe { }
  }
}


/**
 * Handles authentication errors consistently
 */
const handlePassportError = (error: unknown, context: string) => {
  const errorMessage = error instanceof Error ? error.message : 'Unknown error';
  logger.error(`${serviceLocation}: ${context}: ${errorMessage}`);
  LogError(error as Error, serviceLocation, `Error during ${context}.`);
  return error;
};

/**
 * Configure the local authentication strategy
 */
const configureLocalStrategy = () => {
  passport.use(
    new LocalStrategy(async (username, password, done) => {
      try {
        const result = await authenticateUser(username, password);

        if (!result.success && result.message) {
          return done(null, false, { message: result.message });
        }

        if (result.success && result.user) {
          return done(null, result.user);
        }

        throw new Error("Authentication failed in an unexpected way.");
      } catch (error) {
        return done(handlePassportError(error, "Authentication"));
      }
    })
  );
};

/**
 * Configure user serialization for sessions
 */
const configureSessionHandling = () => {
  // Store only the user ID in the session
  passport.serializeUser((user: IUserSafe, done) => {
    logger.info(`${serviceLocation}: Serializing user with ID: ${user._id}`);
    done(null, user._id);
  });

  // Retrieve user from database using stored ID
  passport.deserializeUser(async (id: string, done) => {
    try {
      const result = await readUser({ _id: id });

      if (!result.success) {
        logger.warn(`${serviceLocation}: Deserialization failed for user ID: ${id}`);
        return done(null, false);
      }

      if (result.user) {
        logger.info(`${serviceLocation}: Deserialized user with ID: ${result.user._id}`);
        return done(null, result.user);
      }

      // Edge case: success but no user
      return done(null, false);
    } catch (error) {
      return done(handlePassportError(error, "Deserialization"));
    }
  });
};

// Initialize passport configuration
configureLocalStrategy();
configureSessionHandling();

/**
 * Middleware to check if the user is authenticated
 */
const isAuth = (req: Request, res: Response, next: NextFunction): void => {
  logger.info(`${serviceLocation}: Authenticated User: ${req.user ? JSON.stringify(req.user) : 'undefined'}`);
  if (req.isAuthenticated()) {
    return next();
  }
  res.status(401).json({ message: "Unauthorized. Please log in." });
};


/**
 * Middleware to check if the user is authenticated and has admin role
 */
const isAuthAndAdmin = (req: Request, res: Response, next: NextFunction): void => {
  if (req.isAuthenticated() && req.user.role === UserRole.Admin) {
    return next();
  }
  res.status(403).json({ message: "Forbidden. Admin access required." });
};

/**
 * Middleware to check if the user is authenticated and has User or Admin role
 */
const isAuthAndNotGuest = (req: Request, res: Response, next: NextFunction): void => {
  if (req.isAuthenticated() && req.user.role !== UserRole.Guest) {
    return next();
  }
  res.status(403).json({ message: "Forbidden. Admin or regular user access required." });
};

/**
 * Middleware to check if the user is a Guest only
 */
const isAuthandGuest = (req: Request, res: Response, next: NextFunction): void => {
  if (req.isAuthenticated() && req.user.role === UserRole.Guest) {
    return next();
  }
  res.status(403).json({ message: "Forbidden. Only Guest role allowed." });
}

export { isAuth, isAuthAndAdmin, isAuthAndNotGuest, isAuthandGuest };