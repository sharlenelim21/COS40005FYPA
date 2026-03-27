// File: src/routes/authentication.ts
// Description: Authentication routes for user login, registration, and logout using Passport.js and Express.

import express, { Request, Response, NextFunction } from "express";
import passport from "passport";
import { IUser, IUserSafe, UserRole, createUser, readUser, updateUser, deleteUser, authenticateUser } from "../services/database"; // CRUD + Auth functions for User
import { isAuth, isAuthAndAdmin, isAuthAndNotGuest, isAuthandGuest } from "../services/passportjs"; // Import Passport.js middleware
import logger from "../services/logger"; // Import logger
// import { extractS3KeyFromUrl, deleteFromS3 } from "../services/s3_handler";
import validateFields from "../utils/field_validation"; // Import reusable validation middleware
import { validationResult } from 'express-validator'; // Import express-validator for input validation
import { v4 as uuidv4 } from 'uuid'; // Import UUID for generating unique guest IDs
import { cleanupUserS3Storage } from '../services/s3_handler';
import { handleUserSaveUnsave } from "../jobs/projectcleanupjob"; // Import project handler for user project management

const router = express.Router();
const serviceLocation = "API(Authentication)"; // Service location for logging

router.post("/register",
  // Use all validation fields for registration
  validateFields,
  (req: Request, res: Response, next: NextFunction): void => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      // If validation fails, return a 400 response with error details
      res.status(400).json({ register: false, errors: errors.array() });
    } else {
      next(); // Proceed to registration if validation passes
    }
  },
  async (req: Request, res: Response): Promise<void> => {
    const { username, password, email, phone } = req.body;
    // Create new IUser object
    const newUser: IUser = {
      username,
      password,
      email,
      phone,
      role: UserRole.User, // Default role for new users
    };
    const result = await createUser(newUser);
    if (!result.success) {
      res.status(400).json({ register: false, message: result.message });
      return;
    }
    if (result.success && result.user) {
      logger.info(`${serviceLocation}: ${result.user.username} registered successfully.`);
      res.status(201).json({
        register: true,
        message: "Registration successful.",
        user: result.user,
      });
      return;
    }
  }
);

// Upgrade guest to registered user (tested)
router.post("/register-from-guest",
  isAuthandGuest,
  validateFields, // Validate the fields for upgrade
  (req: Request, res: Response, next: NextFunction): void => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ register: false, errors: errors.array() });
    } else {
      next(); // Proceed to registration if validation passes
    }
  },
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { username, password, email, phone } = req.body;
      const guestUser = req.user;

      if (!guestUser || !guestUser._id) {
        logger.error(`${serviceLocation}: Guest user not found or missing ID.`);
        res.status(400).json({ register: false, message: "Guest user not found." });
        return;
      }

      // Update the guest entry with new details and change role to User
      const updateData = {
        username,
        password,
        email,
        phone,
        role: UserRole.User, // Change role to User
      };
      const result = await updateUser(guestUser._id, updateData);

      // Check if the update was successful
      if (!result.success) {
        logger.error(`${serviceLocation}: Failed to upgrade guest user ${guestUser.username}: ${result.message}`);
        res.status(400).json({ register: false, message: result.message });
        return;
      }

      // If successful, return the updated user information
      if (result.success && result.user) {
        logger.info(`${serviceLocation}: Guest user ${guestUser.username} upgraded to registered user ${result.user.username}.`);
        res.status(200).json({
          register: true,
          message: `Guest ${result.user?.username} upgraded to registered user successfully.`,
          user: result.user,
        });
        return;
      }

    }
    catch (error: unknown) {
      logger.error(`${serviceLocation}: Error during guest upgrade: ${error}`);
      res.status(500).json({ register: false, message: "Internal error during guest upgrade." });
    }
  }
)

router.post("/login",
  [validateFields[0], validateFields[1]],  // Username and password validation
  (req: Request, res: Response, next: NextFunction): void => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ login: false, errors: errors.array() });
    } else {
      next();
    }
  },
  (req: Request, res: Response, next: NextFunction): void => {
    passport.authenticate("local", (err: Error | null, user: IUserSafe, info?: { message: string }) => {
      if (err) {
        logger.error(`${serviceLocation}: Authentication error: ${err}`);
        return res.status(500).json({ message: "Internal error" });
      }
      if (!user) {
        return res.status(401).json({ login: false, message: info?.message });
      }

      return req.logIn(user, (loginErr) => {
        if (loginErr) {
          logger.error(`${serviceLocation}: Login error: ${loginErr}`);
          return res.status(500).json({ message: "Internal error during login." });
        }

        logger.info(`${serviceLocation}: User ${user.username} logged in successfully.`);
        return res.status(200).json({
          login: true,
          username: user.username,
          role: user.role,
          message: "Login successful.",
        });
      });
    })(req, res, next);
  }
);

router.post("/logout", isAuth, async (req: Request, res: Response): Promise<void> => {
  const user = req.user;
  const isGuest = user && typeof user.username === 'string' && user.username.startsWith('guest_');
  const userId = user?._id;
  const username = user?.username;

  // Log the user attempting to log out
  if (user) {
    logger.info(`${serviceLocation}: User ${username || userId} attempting to log out.`);
  } else {
    logger.info(`${serviceLocation}: Authenticated user attempting to log out (username/ID not available on req.user).`);
  }

  // Handle the logout process
  req.logout(async (err: Error | null) => {
    logger.info(`${serviceLocation}: req.logout() callback executed.`);

    if (err) {
      logger.error(err);
      res.status(500).json({ message: "Internal error when logging out." });
      return; // Stop further execution
    }
    // If this is a guest user, delete their account and associated data
    if (isGuest && userId) {
      try {
        logger.info(`${serviceLocation}: Cleaning up guest user account: ${username}`);

        // Step 1: Cleanup S3 files for the guest user
        await cleanupUserS3Storage(userId);

        // Step 2: Delete the user, which will cascade delete all associated records
        const deleteResult = await deleteUser(userId);

        if (deleteResult.success) {
          logger.info(`${serviceLocation}: Guest user ${username} (${userId}) and all associated data deleted successfully.`);
        } else {
          logger.warn(`${serviceLocation}: Failed to delete guest user ${username} (${userId}): ${deleteResult.message}`);
        }
      } catch (cleanupError) {
        logger.error(`${serviceLocation}: Error during guest cleanup for ${username} (${userId}): ${cleanupError}`);
        // Continue with response even if cleanup fails - the user is still logged out
      }
    }

    // If this is a regular user (not a guest), handle their projects
    if (!isGuest && userId) {
      try {
        logger.info(`${serviceLocation}: Cleaning up user projects for user: ${username}`);

        // Use handleUserSaveUnsave to process user projects
        await handleUserSaveUnsave(userId, false); // Set isSaved=false to delete unsaved projects

        logger.info(`${serviceLocation}: User ${username} (${userId}) projects processed successfully.`);
      } catch (cleanupError) {
        logger.error(`${serviceLocation}: Error during user project cleanup for ${username} (${userId}): ${cleanupError}`);
        // Continue with response even if cleanup fails - the user is still logged out
      }
    }

    // Add a log to indicate successful session destruction
    logger.info(`${serviceLocation}: Session successfully destroyed after logout.`);

    // Send response indicating successful logout
    res.status(200).json({ message: "Logout successful." });
  });
});

// Delete user route
router.post("/delete",
  isAuthAndNotGuest,
  async (req: Request, res: Response): Promise<void> => {
    try {
      if (req.user && req.user._id) {
        const userId = req.user._id;

        // Clean up user data before deletion
        await cleanupUserS3Storage(userId);

        // Delete the user from the database
        const deleteResult = await deleteUser(userId);

        if (!deleteResult.success) {
          res.status(400).json({ delete: false, message: deleteResult.message });
          return;
        }

        logger.info(`${serviceLocation}: User ${userId} deleted successfully.`);
        res.status(200).json({
          delete: true,
          message: "User deleted successfully.",
        });
      }
    }
    catch (error: unknown) {
      logger.error(`${serviceLocation}: Error during user deletion: ${error}`);
      res.status(500).json({ message: "Internal error during user deletion." });
    }
  }
);

// Guest login route
router.post("/guest", async (req: Request, res: Response): Promise<void> => {
  try {
    const guestID = uuidv4();
    const username = `guest_${guestID}`;
    const password = `pass_${uuidv4()}`;
    const email = `${guestID}@guestmail.com`;
    const phone = `000-${Math.floor(10000000 + Math.random() * 90000000)}`;

    // Create a new guest user with the generated credentials
    const newGuestUser: IUser = {
      username,
      password,
      email,
      phone,
      role: UserRole.Guest, // Default role for guest users
    };
    const result = await createUser(newGuestUser);

    if (!result.success || !result.user) {
      logger.error(`${serviceLocation}: Guest registration failed: ${result.message}`);
      res.status(500).json({ login: false, message: "Failed to create guest account." });
      return;
    }

    if (!result.user) {
      logger.error(`${serviceLocation}: Guest login failed: User is undefined.`);
      res.status(500).json({ message: "Guest login failed." });
      return;
    }

    return req.logIn(result.user, (err) => {
      if (err) {
        logger.error(`${serviceLocation}: Guest login error: ${err}`);
        res.status(500).json({ message: "Guest login failed." });
        return;
      }

      logger.info(`${serviceLocation}: Guest user ${result.user!.username} logged in successfully.`);
      return res.status(200).json({
        login: true,
        guest: true,
        username: result.user!.username,
        role: result.user!.role,
        message: "Logged in as guest.",
      });
    });
  } catch (error: unknown) {
    logger.error(`${serviceLocation}: Guest Login - Unexpected error during guest login: ${error}`);
    res.status(500).json({ message: "Unexpected error during guest login." });
    return;
  }
});

// Update route for user information
router.post("/update",
  // Validate the input fields for update
  validateFields,
  isAuthAndNotGuest, async (req: Request, res: Response): Promise<void> => {
    try {
      if (req.user && req.user._id) {
        const userid = req.user._id;
        // Only allow updates to username, email, and phone (not password or role)
        const { username, email, phone } = req.body;

        // If other fields are provided, respond with an error
        if (Object.keys(req.body).length > 3 || !username || !email || !phone) {
          res.status(400).json({ update: false, message: "Only username, email, and phone fields are allowed." });
          return;
        }

        // Update the user information in the database
        const result = await updateUser(userid, { username, email, phone });

        if (!result.success) {
          res.status(400).json({ update: false, message: result.message });
          return;
        }

        logger.info(`${serviceLocation}: User ${userid} updated successfully.`);
        res.status(200).json({
          update: true,
          message: "User information updated successfully.",
          user: result.user,
        });
      }
    }
    catch (error: unknown) {
      logger.error(`${serviceLocation}: Error during user update: ${error}`);
      res.status(500).json({ message: "Internal error during user update." });
    }
  });

// Update route for user password
router.post("/update-password",
  isAuthAndNotGuest,
  validateFields[1], async (req: Request, res: Response): Promise<void> => {
    try {
      if (req.user && req.user._id) {
        const userid = req.user._id;
        const { old_password, password } = req.body;

        // If other fields are provided, respond with an error
        if (Object.keys(req.body).length > 2 || !old_password || !password) {
          res.status(400).json({ update: false, message: "Only old_password and password fields are allowed." });
          return;
        }

        // Check if the old password is correct
        const isPasswordValid = await authenticateUser(req.user.username, old_password);
        if (!isPasswordValid.success) {
          res.status(401).json({ update: false, message: "Old password is incorrect." });
          return;
        }

        // Update the user password in the database
        const result = await updateUser(userid, { password });

        if (!result.success) {
          res.status(400).json({ update: false, message: result.message });
          return;
        }

        logger.info(`${serviceLocation}: User ${userid} password updated successfully.`);
        res.status(200).json({
          update: true,
          message: "User password updated successfully.",
          user: result.user,
        });
      }
    }
    catch (error: unknown) {
      logger.error(`${serviceLocation}: Error during user password update: ${error}`);
      res.status(500).json({ message: "Internal error during user password update." });
    }
  });

// Update route for user role
router.post("/update-role",
  isAuthAndAdmin,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { username, newrole } = req.body;
      if (!username || !newrole) {
        res.status(400).json({ update: false, message: "User ID and new role are required." });
        return;
      }
      // Find the user by username
      const userExists = await readUser({ username });
      if (userExists && userExists.users && userExists.users.length === 0) {
        res.status(404).json({ update: false, message: "User not found." });
        return;
      }
      if (userExists && userExists.users && userExists.users.length === 1) {
        const user = userExists.users[0];
        // Update the user role in the database
        if (user && user._id) {
          const result = await updateUser(user._id, { role: newrole });
          if (!result.success) {
            res.status(400).json({ update: false, message: result.message });
            return;
          }
          logger.info(`${serviceLocation}: User ${username} role updated to ${newrole}.`);
          res.status(200).json({
            update: true,
            message: `User ${username} role updated to ${newrole}.`,
            user: result.user,
          });
        }
      }
    } catch (error: unknown) {
      logger.error(`${serviceLocation}: Error during user role update: ${error}`);
      res.status(500).json({ message: "Internal error during user role update." });
    }
  }
)

// Fetch user information route
router.get("/fetch", isAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    // Extract user ID from the authenticated session
    const userId = String(req.user?._id);

    // Fetch user information from the database
    const result = await readUser({ _id: userId });

    if (!result.success || !result.user) {
      res.status(404).json({ fetch: false, message: "User not found." });
      return;
    }

    logger.info(`${serviceLocation}: Fetched user info for ${result.user.username}.`);
    res.status(200).json({
      fetch: true,
      message: "User information fetched successfully.",
      user: result.user,
    });
  } catch (error: unknown) {
    logger.error(`${serviceLocation}: Error fetching user info: ${error}`);
    res.status(500).json({ fetch: false, message: "Internal error during user fetch." });
  }
});

// Admin-only route
// This route is restricted to admin users only. It ensures the user is logged in and has the admin role.
router.get("/admin", isAuthAndAdmin, (req: Request, res: Response) => {
  res.status(200).json({ message: "You are an admin!" });
});

// Admin-only route to delete a user
// Admin-only route to delete a user by username
router.post("/admin-delete-user",
  isAuthAndAdmin,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { usernameToDelete } = req.body; // Expecting usernameToDelete in the request body

      if (!usernameToDelete) {
        res.status(400).json({ delete: false, message: "Username to delete is required." });
        return;
      }

      // Check if the user exists by username
      const userExistsResult = await readUser({ username: usernameToDelete });

      if (!userExistsResult.success || !userExistsResult.users || userExistsResult.users.length === 0) {
        res.status(404).json({ delete: false, message: `User with username '${usernameToDelete}' not found.` });
        return;
      }

      // Assuming readUser returns an array and we take the first one if multiple (though username should be unique)
      const userToDelete = userExistsResult.users[0];

      if (!userToDelete._id) {
        logger.error(`${serviceLocation}: User '${usernameToDelete}' found but has no _id.`);
        res.status(500).json({ delete: false, message: "User data is inconsistent; missing ID." });
        return;
      }

      const userIdToDelete = userToDelete._id;

      // Clean up user data before deletion using their ID
      await cleanupUserS3Storage(userIdToDelete);

      // Delete the user from the database using their ID
      const deleteResult = await deleteUser(userIdToDelete);

      if (!deleteResult.success) {
        res.status(400).json({ delete: false, message: deleteResult.message || `Failed to delete user '${usernameToDelete}'.` });
        return;
      }

      logger.info(`${serviceLocation}: Admin deleted user '${usernameToDelete}' (ID: ${userIdToDelete}) successfully.`);
      res.status(200).json({
        delete: true,
        message: `User '${usernameToDelete}' deleted successfully by admin.`,
      });

    } catch (error: unknown) {
      logger.error(`${serviceLocation}: Error during admin user deletion (username: ${req.body.usernameToDelete}): ${error}`);
      res.status(500).json({ delete: false, message: "Internal error during admin user deletion." });
    }
  }
);

// Admin route to update any user's information
router.post("/admin-update-user",
  isAuthAndAdmin,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { targetUsername, updates } = req.body;

      if (!targetUsername) {
        res.status(400).json({ update: false, message: "Target username is required." });
        return;
      }

      if (!updates || Object.keys(updates).length === 0) {
        res.status(400).json({ update: false, message: "No update information provided." });
        return;
      }

      // Find the user by username
      const userToUpdateResult = await readUser({ username: targetUsername });

      if (!userToUpdateResult.success || !userToUpdateResult.users || userToUpdateResult.users.length === 0) {
        res.status(404).json({ update: false, message: `User "${targetUsername}" not found.` });
        return;
      }

      const userToUpdate = userToUpdateResult.users[0];
      if (!userToUpdate._id) {
        res.status(500).json({ update: false, message: "User ID is missing for the target user." });
        return;
      }

      // Prepare the updates object, filtering for allowed fields
      const allowedUpdates: {
        username?: string;
        email?: string;
        phone?: string;
        role?: UserRole;
        password?: string;
      } = {};

      if (updates.username !== undefined) allowedUpdates.username = updates.username;
      if (updates.email !== undefined) allowedUpdates.email = updates.email;
      if (updates.phone !== undefined) allowedUpdates.phone = updates.phone;
      if (updates.role !== undefined) allowedUpdates.role = updates.role;
      if (updates.password !== undefined) allowedUpdates.password = updates.password;

      if (Object.keys(allowedUpdates).length === 0) {
        res.status(400).json({ update: false, message: "No valid fields provided for update." });
        return;
      }

      // Update the user information in the database
      const result = await updateUser(userToUpdate._id, allowedUpdates);

      if (!result.success) {
        res.status(400).json({ update: false, message: result.message });
        return;
      }

      logger.info(`${serviceLocation}: Admin ${req.user?.username} updated user ${targetUsername} successfully.`);
      res.status(200).json({
        update: true,
        message: `User ${targetUsername}'s information updated successfully.`,
        user: result.user, // Contains the updated user information (excluding password)
      });

    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      logger.error(`${serviceLocation}: Error during admin user update: ${errorMessage}`);
      res.status(500).json({ update: false, message: "Internal error during admin user update." });
    }
  }
);

// Fetch all users route (Admin only)
router.get("/users", isAuthAndAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await readUser({}); // Or readUser() if that's the convention

    if (!result.success || !result.users) {
      res.status(404).json({ fetch: false, message: "No users found or error fetching users." });
      return;
    }

    logger.info(`${serviceLocation}: Fetched all users.`);
    res.status(200).json({
      fetch: true,
      message: "All users fetched successfully.",
      users: result.users, // Assuming result.users is an array of IUserSafe
    });
  } catch (error: unknown) {
    logger.error(`${serviceLocation}: Error fetching all users: ${error}`);
    res.status(500).json({ fetch: false, message: "Internal error during user fetch." });
  }
});

// Middleware-protected route
// This route is only accessible to users who are logged in (i.e., authenticated users). It acts as a basic protected endpoint.
router.get("/protected", isAuth, (req: Request, res: Response) => {
  res.status(200).json({ message: "You are authenticated!", you: req.user?.username });
});

// Admin-only route
// This route is restricted to admin users only. It ensures the user is logged in and has the admin role.
router.get("/admin", isAuthAndAdmin, (req: Request, res: Response) => {
  res.status(200).json({ message: "You are an admin!" });
});

export default router;