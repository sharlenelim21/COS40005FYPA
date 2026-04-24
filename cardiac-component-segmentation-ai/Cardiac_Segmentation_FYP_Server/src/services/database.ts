// File: src/services/database.ts
// Description: Database Service for the VisHeart Server
import mongoose, { Schema, model, Model } from "mongoose";
import path from "path";
import dotenv from "dotenv";
import logger from "./logger";
import * as bcrypt from "bcrypt";
import { loadEnvFromKnownLocations } from "../utils/env";

// Import utility functions
import LogError from "../utils/error_logger"; // Import the error logging utility
const serviceLocation = "Database"; // Service location for error logging

// Import Types
import { IUser, IUserDocument, IUserSafe, UserRole, CRUDOperation, UserCrudResult, IProjectDocument, IProjectSegmentationMaskDocument, segmentationSource } from "../types/database_types"; // Import the user types
import { FileType, FileDataType, ComponentBoundingBoxesClass, IProject, IProjectSegmentationMask, ProjectCrudResult, ProjectSegmentationMaskCrudResult } from "../types/database_types"; // Import the project types
import { IProjectReconstruction, IProjectReconstructionDocument, ProjectReconstructionCrudResult, MeshFormat } from "../types/database_types"; // Import the project reconstruction types
import { JobStatus, IJob, IJobDocument, JobCrudResult, SegmentationModel } from "../types/database_types"; // Import the job types
import { IGPUHost, IGPUHostDocument, GPUHostCrudResult } from "../types/database_types"; // Import the GPU host types

// Load environment variables from .env file
try {
  // override: true allows to override cached environment variables
  loadEnvFromKnownLocations(__dirname);
} catch (error: unknown) {
  LogError(error as Error, serviceLocation, "Error loading .env file.");
};

// Database connection URL and name
const DB_NAME = "visheart";
const DB_URI: string = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/visheart";

// Fetch default admin password
const adminPass: string = process.env.ADMIN_PASS || "P@ssw0rd123!"; // Default to "P@ssw0rd123!" (follows the validation) if not set

// Connect to MongoDB (called in index.ts)
// Added parameter so can be used in test files to connect to a different database if needed, but default is the environment variable
/**
 * Connects to the MongoDB database using the Mongoose library and the connection URI
 * @async
 * @function connectToDatabase
 * @returns {Promise<void>} A promise that resolves when the database connection is established
 * and the admin user check is complete.
 * @throws {Error} Throws an error if the connection to the MongoDB database fails,
 * wrapping the original Mongoose connection error.
 */
const connectToDatabase = async (): Promise<void> => {
  try {
    // 0=disconnected, 1=connected, 2=connecting, 3=disconnecting
    // Added this for unit test to use the createAdminUser function without explicitly exposing it
    if (mongoose.connection.readyState !== 1) {
      await mongoose.connect(DB_URI);

      // Verify if connection is ready (to prevent race conditions with GPU configuration fetch)
      if (mongoose.connection.db) {
        await mongoose.connection.db.admin().ping();
        // Hide the database URI in production for security
        const showDBURI = process.env.NODE_ENV === 'development' ? DB_URI : '"hidden due to production environment"';
        logger.info(`${serviceLocation}: Connected to MongoDB database: ${DB_NAME} at ${showDBURI}`);
      } else {
        throw new Error("Database connection established but db object is undefined.");
      }
    } else {
      logger.info(`${serviceLocation}: Already connected to ${DB_NAME}. Skipping connect call.`);
    }
    await createAdminUser();
    await seedGPUHost(); // Seed the GPU host configuration based on env vars
  } catch (error: unknown) {
    LogError(error as Error, serviceLocation, `Error connecting to MongoDB database: ${DB_NAME} at ${DB_URI}`)
    throw new Error(`Error connecting to MongoDB: ${error}`);
  }
};

/**
 * Converts a Mongoose user document (`IUserDocument`) into a safe user object (`IUserSafe`)
 * by selecting specific fields and converting the `_id` to a string.
 * This is used to prepare user data for responses, removing sensitive information like the password.
 *
 * @function toIUserSafe
 * @param {IUserDocument} user - The Mongoose user document to convert.
 * @returns {IUserSafe} A new object containing only the safe-to-expose user properties.
 */
function toIUserSafe(user: IUserDocument): IUserSafe {
  return {
    _id: String(user._id),
    username: user.username,
    email: user.email,
    phone: user.phone,
    role: user.role,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

/* User Collection Creation */
// User Collection
const userSchema = new Schema<IUserDocument>({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  phone: { type: String, required: true, unique: true },
  role: { type: String, required: true, enum: Object.values(UserRole), default: UserRole.User },
}, { timestamps: true }); // Automatically add createdAt and updatedAt timestamps
// Hooks for pre-save and pre-delete operations (must be before the model creation)
// If a user is deleted, delete all their projects, segmentation masks, and reconstructions (especially important for guest accounts)
userSchema.pre('deleteOne', { document: true, query: false }, async function (next) {
  const serviceLocationCascade = `${serviceLocation} - User Delete Hook`;
  try {
    logger.info(`${serviceLocation}: Cascade delete triggered for user ${this._id}`);
    const projects = await projectModel.find({ userid: this._id }).select('_id').lean(); // Use lean for plain objects
    const projectIds = projects.map(p => p._id);
    if (projectIds.length > 0) {
      logger.info(`${serviceLocation}: Deleting ${projectIds.length} projects and their associated data for user ${this._id}`);
      
      // Delete all reconstructions for all found projects first
      const reconstructionDeleteResult = await projectReconstructionModel.deleteMany({ projectid: { $in: projectIds } });
      logger.info(`${serviceLocation}: Deleted ${reconstructionDeleteResult.deletedCount} reconstructions for user ${this._id}`);
      
      // Delete all masks for all found projects
      const maskDeleteResult = await projectSegmentationMaskModel.deleteMany({ projectid: { $in: projectIds } });
      logger.info(`${serviceLocation}: Deleted ${maskDeleteResult.deletedCount} segmentation masks for user ${this._id}`);
      
      // Then delete all projects for the user
      const projectDeleteResult = await projectModel.deleteMany({ userid: this._id });
      logger.info(`${serviceLocation}: Deleted ${projectDeleteResult.deletedCount} projects for user ${this._id}`);
    } else {
      logger.info(`${serviceLocation}: No projects found for user ${this._id}. No cascade delete needed for projects/masks/reconstructions.`);
    }
    next(); // Proceed to user deletion
  } catch (error: unknown) {
    LogError(error as Error, serviceLocationCascade, `Error during cascade delete for user ${this._id}.`);
    // Halt the original user deletion by passing the error
    next(error instanceof Error ? error : new Error('Failed to cascade delete projects/masks'));
  }
});
// Create the model with proper typing
const userModel = model<IUserDocument, Model<IUserDocument>>("User", userSchema);

/**
 * Checks if an administrator user exists in the database. If not, creates a default
 * administrator account with predefined credentials ("admin" username, password from
 * `ADMIN_PASS` environment variable or "admin" default, default email/phone).
 * This function is typically called internally during database initialization (`connectToDatabase`).
 * It logs information about whether an admin exists or if a default one is created.
 * A warning is logged upon successful creation of the default admin, advising password change.
 *
 * @async
 * @function createAdminUser
 * @returns {Promise<void>} A promise that resolves once the check and potential creation are complete.
 * @throws {Error} Logs an error via `LogError` if any database operation fails during the process.
 */
const createAdminUser = async (): Promise<void> => {
  // Check if an admin user exists
  // Cannot use IUserDocument ONLY here because it may return null if no admins exist.
  // If it returns a user, TypeScript auto casts it to IUserDocument because of const User = model<IUserDocument, Model<IUserDocument>>("User", userSchema);.
  // The default is IUserDocument | null but can just let auto infer the type.
  const existingAdmin = await userModel.findOne({ role: UserRole.Admin });
  try {
    if (!existingAdmin) {
      logger.info(
        `${serviceLocation}: No admin account found. Creating default admin account.`
      );
      // Create an admin user with username "admin" and password "admin" (Emergency creation of admin account in case of no admin account)
      const hashedPassword = await bcrypt.hash(adminPass, 10);
      // Here, can use IUserDocument because it is guaranteed to be a user and not null.
      const admin: IUserDocument = new userModel({
        username: "admin",
        password: hashedPassword,
        email: "admin@example.com",
        phone: "1234567890",
        role: UserRole.Admin,
      });
      // Save the admin user to the database
      await admin.save();
      // Check if the admin user was created successfully
      const createdAdmin = await userModel.findOne({ username: "admin" });
      if (createdAdmin) logger.warn(`${serviceLocation}: WARNING: Default admin account created successfully with ID:${createdAdmin._id}. Please change the password IMMEDIATELY.`);
    } else {
      logger.info(`${serviceLocation}: Admin account(s) already exists.`);
      return;
    }
  } catch (error: unknown) {
    LogError(error as Error, serviceLocation, "Error checking or creating admin account.");
  }
};


// User Functions
/**
 * Creates a new user record in the database with the provided details.
 * Hashes the password using bcrypt before storing it.
 * Checks for uniqueness constraints on username, email, and phone number.
 *
 * @async
 * @function createUser
 * @param {IUser} user - The user object containing the details for the new user.
 * @param {string} user.username - The desired username for the new user (must be unique).
 * @param {string} user.password - The plain-text password for the new user.
 * @param {string} user.email - The email address for the new user (must be unique).
 * @param {string} user.phone - The phone number for the new user (must be unique).
 * @param {UserRole} [user.role=UserRole.User] - The role to assign to the user. Defaults to `UserRole.User`.
 * @returns {Promise<UserCrudResult>} A promise that resolves to a `UserCrudResult` object.
 * - On success: `{ success: true, operation: CRUDOperation.CREATE, user: IUserSafe }` containing the sanitized created user.
 * - On validation failure (duplicate username/email/phone): `{ success: false, operation: CRUDOperation.CREATE, message: string }` detailing the conflict.
 * - On other errors: `{ success: false, operation: CRUDOperation.CREATE, message: "Error creating user." }`.
 */
const createUser = async (
  user: IUser,
): Promise<UserCrudResult> => {
  try {
    // Use a single query with $or to check all unique constraints
    const existingUser = await userModel.findOne({
      $or: [{ username: user.username }, { email: user.email }, { phone: user.phone }],
    });
    if (existingUser) {
      let reasons = `User already exists:`;
      if (existingUser.username === user.username) {
        reasons += ` Username "${user.username}" already exists.`;
      }
      if (existingUser.email === user.email) {
        reasons += ` Email "${user.email}" already exists.`;
      }
      if (existingUser.phone === user.phone) {
        reasons += ` Phone "${user.phone}" already exists.`;
      }
      logger.warn(`${serviceLocation}: Error creating user: ${reasons}`);
      return { success: false, operation: CRUDOperation.CREATE, message: reasons };
    }
    // Hash the password before saving it to the database
    const hashedPassword = await bcrypt.hash(user.password, 10);
    // Create a new user instance
    const newUser: IUserDocument = new userModel({
      username: user.username,
      password: hashedPassword,
      email: user.email,
      phone: user.phone,
      role: user.role,
    });
    // Save the new user to the database
    await newUser.save();
    logger.info(`${serviceLocation}: User ${newUser._id} created successfully: ${newUser.username}, ${newUser.email}, ${newUser.phone}, ${newUser.role}`);
    return { success: true, operation: CRUDOperation.CREATE, user: toIUserSafe(newUser) };
  } catch (error: unknown) {
    logger.error(`${serviceLocation}: Error creating user ${user.username}: ${error}`);
    LogError(error as Error, serviceLocation, `Error creating user ${user.username}.`);
    return { success: false, operation: CRUDOperation.CREATE, message: "Error creating user." };
  }
};

/**
 * Reads user(s) from the database based on various optional search criteria.
 * If an `id` is provided, it attempts to find a single user by their MongoDB ObjectId.
 * If a `user` object is provided, it searches for users matching any of the provided fields
 * (username, email, phone, role) using an OR condition.
 * If neither `id` nor `user` criteria are provided, it returns all users.
 * All returned user data is sanitized using `toIUserSafe` to exclude sensitive information like passwords.
 *
 * @async
 * @function readUser
 * @param {Partial<IUserSafe>} [user] - Optional object containing user fields to filter by.
 *                                  Supports `_id`, `username`, `email`, `phone`, and `role`.
 *                                  If multiple fields are provided, users matching *any* of them are returned.
 * @returns {Promise<UserCrudResult>} A promise that resolves to a `UserCrudResult` object.
 * - On success (found by ID): `{ success: true, operation: CRUDOperation.READ, user: IUserSafe }` containing the sanitized user.
 * - On success (found by criteria or all users): `{ success: true, operation: CRUDOperation.READ, users: IUserSafe[] }` containing an array of sanitized users.
 * - On success (no users found): `{ success: true, operation: CRUDOperation.READ, users: [], message: "No users found..." }`.
 * - On error: `{ success: false, operation: CRUDOperation.READ, message: "Error reading user." }`.
 */
const readUser = async (
  user?: Partial<IUserSafe>
): Promise<UserCrudResult> => {
  const searchConditions: object[] = [];
  if (user?._id) searchConditions.push({ _id: user?._id }); // Add support for searching by ID
  if (user?.username) searchConditions.push({ username: user?.username });
  if (user?.email) searchConditions.push({ email: user?.email });
  if (user?.phone) searchConditions.push({ phone: user?.phone });
  if (user?.role) searchConditions.push({ role: user?.role });

  const filterCriteriaString = searchConditions.length > 0
    ? searchConditions.map(cond => JSON.stringify(cond)).join(' OR ')
    : 'all users';

  try {
    if (searchConditions.length === 0) {
      logger.info(`${serviceLocation}: Reading all users.`);
      const foundUsers = await userModel.find({});
      const safeUsers = foundUsers.map(toIUserSafe);
      return {
        success: true,
        operation: CRUDOperation.READ,
        users: safeUsers,
      };
    } else {
      const query = { $or: searchConditions };
      logger.info(`${serviceLocation}: Reading users matching ANY of: ${filterCriteriaString}`);
      const foundUsers = await userModel.find(query);

      if (foundUsers.length === 0) {
        logger.info(`${serviceLocation}: No users found matching criteria: ${filterCriteriaString}`);
        return {
          success: true,
          operation: CRUDOperation.READ,
          users: [],
          message: "No users found matching the specified criteria.",
        };
      }

      // If searching by ID, return a single user in the `user` field
      if (user?._id) {
        const user = foundUsers[0]; // Assume ID is unique
        return {
          success: true,
          operation: CRUDOperation.READ,
          user: toIUserSafe(user),
        };
      }

      const safeUsers = foundUsers.map(toIUserSafe);
      return {
        success: true,
        operation: CRUDOperation.READ,
        users: safeUsers,
      };
    }
  } catch (error: unknown) {
    LogError(error as Error, serviceLocation, `Error reading user with ID: ${user?._id} and error message: ${error}`);
    return { success: false, operation: CRUDOperation.READ, message: "Error reading user." };
  }
};

/**
 * Updates an existing user's record in the database.
 * The user to update is identified by their current `userid`.
 * The `updates` object specifies which fields to change. At least one valid field must be provided for an update to occur.
 * If `password` is provided, it will be hashed before saving.
 * Checks for uniqueness conflicts if `username`, `email`, or `phone` are being changed, ensuring the new value isn't already used by *another* user.
 *
 * @async
 * @function updateUser
 * @param {string} userid - The current id of the user to update. This is used for the initial lookup and can be taken from session (doubling as authentication).
 * @param {object} updates - An object containing the fields to update. All properties are optional.
 * @param {string} [updates.username] - The new username.
 * @param {string} [updates.password] - The new plain-text password.
 * @param {string} [updates.email] - The new email address.
 * @param {string} [updates.phone] - The new phone number.
 * @param {UserRole} [updates.role] - The new role for the user.
 * @returns {Promise<UserCrudResult>} A promise that resolves to a `UserCrudResult` object.
 * - On success: `{ success: true, operation: CRUDOperation.UPDATE, user: IUserSafe }` containing the sanitized, updated user.
 * - On failure (user not found): `{ success: false, operation: CRUDOperation.UPDATE, message: "User ... does not exist." }`.
 * - On failure (no changes provided): `{ success: false, operation: CRUDOperation.UPDATE, message: "No fields to update..." }`.
 * - On failure (uniqueness conflict): `{ success: false, operation: CRUDOperation.UPDATE, message: "Username/Email/Phone ... already in use..." }`.
 * - On other errors: `{ success: false, operation: CRUDOperation.UPDATE, message: "Error updating user." }`.
 */
const updateUser = async (
  // Identifying parameter
  userid: string,
  // Updates object
  updates: {
    username?: string;
    password?: string;
    email?: string;
    phone?: string;
    role?: UserRole;
  }
): Promise<UserCrudResult> => {
  try {
    // Check if the user exists
    const existingUser = await userModel.findOne({ _id: userid });
    if (!existingUser) {
      logger.warn(`${serviceLocation}: User ${userid} does not exist.`);
      return { success: false, operation: CRUDOperation.UPDATE, message: `User ${userid} does not exist.` };
    }

    // NOTE - use user._id from session from now on instead of username because username be one of the fields being updated.
    // Create update object and track what fields are being updated
    const updateData: Partial<IUser> = {};
    const unchangedFields: string[] = [];

    // Check password (hash first)
    if (updates.password !== undefined) {
      const samePassword = await bcrypt.compare(
        updates.password,
        existingUser.password
      );
      if (samePassword) {
        unchangedFields.push("password");
      } else {
        updateData.password = await bcrypt.hash(updates.password, 10);
      }
    }

    // Check username
    if (updates.username !== undefined) {
      if (updates.username === existingUser.username) {
        unchangedFields.push("username");
      } else {
        // Check if the username is already in use by another user
        const usernameExists = await userModel.findOne({
          username: updates.username,
          _id: { $ne: existingUser._id }, // Exclude current user
        });
        if (usernameExists) return { success: false, operation: CRUDOperation.UPDATE, message: `Username "${updates.username}" is already in use by another user.`, };
        updateData.username = updates.username;
      }
    }

    // Check email
    if (updates.email !== undefined) {
      if (updates.email === existingUser.email) {
        unchangedFields.push("email");
      } else {
        // Check if the email is already in use by another user
        const emailExists = await userModel.findOne({
          email: updates.email,
          _id: { $ne: existingUser._id }  // Exclude current user
        });

        if (emailExists) {
          return { success: false, operation: CRUDOperation.UPDATE, message: `Email "${updates.email}" is already in use by another user.`, };
        }
        updateData.email = updates.email;
      }
    }

    // Check phone
    if (updates.phone !== undefined) {
      if (updates.phone === existingUser.phone) {
        unchangedFields.push("phone");
      } else {
        // Check if the phone is already in use by another user
        const phoneExists = await userModel.findOne({
          phone: updates.phone,
          _id: { $ne: existingUser._id } // Exclude current user
        });

        if (phoneExists) {
          return { success: false, operation: CRUDOperation.UPDATE, message: `Phone "${updates.phone}" is already in use by another user.`, };
        }
        updateData.phone = updates.phone;
      }
    }

    // Add role update capability
    if (updates.role !== undefined) {
      if (updates.role === existingUser.role) {
        unchangedFields.push("role");
      } else {
        updateData.role = updates.role;
      }
    }

    // Return if no fields were updated at all
    if (Object.keys(updateData).length === 0) {
      logger.warn(`${serviceLocation}: No fields to update for user ${userid}. Unchanged fields: ${unchangedFields.join(", ")}`);
      return { success: false, operation: CRUDOperation.UPDATE, message: `No fields to update for user ${userid}.`, };
    }

    // Perform the update
    const updatedUser = existingUser.set(updateData);
    await updatedUser.save();
    logger.info(`${serviceLocation}: User ${userid} with username ${updatedUser.username} updated successfully. Updated fields: ${Object.keys(updateData).join(", ")}`);
    return { success: true, operation: CRUDOperation.UPDATE, user: toIUserSafe(updatedUser) };
  } catch (error: unknown) {
    LogError(error as Error, serviceLocation, `Error updating user ${userid}.`);
    return { success: false, operation: CRUDOperation.UPDATE, message: "Error updating user." };
  }
};

/**
 * Deletes a user from the database by ID and cascade deletes all associated projects and segmentation masks.
 * Includes a safety check to prevent deletion of the last remaining administrator account.
 *
 * @async
 * @function deleteUser
 * @param {string} user_id - The ID of the user to delete.
 * @returns {Promise<UserCrudResult>} A promise that resolves to a `UserCrudResult` object.
 * - On success: `{ success: true, operation: CRUDOperation.DELETE, message: "User ... deleted successfully." }`.
 * - On failure (user not found): `{ success: false, operation: CRUDOperation.DELETE, message: "User ... does not exist." }`.
 * - On failure (attempting to delete last admin): `{ success: false, operation: CRUDOperation.DELETE, message: "Cannot delete the last administrator account" }`.
 * - On other errors: `{ success: false, operation: CRUDOperation.DELETE, message: "Error when deleting user." }`.
 */
const deleteUser = async (user_id: string): Promise<UserCrudResult> => {
  const operation = CRUDOperation.DELETE;
  try {

    // Check if the user exists
    const existingUser = await userModel.findOne({ _id: user_id });
    // Check if the user is an admin and if this is the last admin
    if (existingUser && existingUser.role === UserRole.Admin) {
      // Check if this is the last admin
      const adminCount = await userModel.countDocuments({ role: UserRole.Admin });
      if (adminCount <= 1) {
        logger.warn(`${serviceLocation}: Attempted to delete last admin user: ${existingUser.username}`);
        return { success: false, operation, message: 'Cannot delete the last administrator account' };
      }
    }
    if (!existingUser) {
      logger.warn(`${serviceLocation}: User ${user_id} does not exist.`);
      return { success: false, operation, message: `User ${user_id} does not exist.` };
    }
    // Delete the user
    await existingUser.deleteOne();
    // Check if the user was deleted successfully using readUser function
    const deletedUserResult = await readUser({ _id: user_id });
    if (deletedUserResult.success && deletedUserResult.users && deletedUserResult.users.length > 0) {
      // This condition should ideally not be met if deleteOne succeeded without error,
      // but it's kept as a safeguard based on the original code's logic.
      logger.warn(`${serviceLocation}: User ${deletedUserResult.user?._id} was not deleted successfully.`);
      return { success: false, operation, message: `User ${user_id} was not deleted successfully.` };
    }
    // User deleted successfully
    logger.info(`${serviceLocation}: User ${user_id} deleted successfully.`);
    return { success: true, operation, message: `User ${user_id} deleted successfully.` };

  } catch (error: unknown) {
    LogError(error as Error, serviceLocation, `Error deleting user ${user_id} with error: ${error}.`);
    return { success: false, operation, message: "Error when deleting user." };
  }
};

// Auxiliary User functions
/**
 * Authenticates a user by verifying the provided username and password against the database records.
 * Performs basic input validation (non-empty username and password).
 * Compares the provided password attempt against the stored hash using bcrypt.
 * Returns a generic error message for common failure scenarios (user not found, incorrect password)
 * to avoid leaking information.
 *
 * @async
 * @function authenticateUser
 * @param {string} username - The username provided for authentication. Must be a non-empty string.
 * @param {string} passwordAttempt - The plain-text password provided for authentication. Must not be null, undefined, or empty.
 * @returns {Promise<UserCrudResult>} A promise that resolves to a `UserCrudResult` object.
 * - On successful authentication: `{ success: true, operation: CRUDOperation.AUTHENTICATE, user: IUserSafe }` containing the sanitized authenticated user.
 * - On authentication failure (invalid input, user not found, password mismatch): `{ success: false, operation: CRUDOperation.AUTHENTICATE, message: "Invalid username or password." }`.
 * - On failure due to account configuration issue (e.g., missing password hash in DB): `{ success: false, operation: CRUDOperation.AUTHENTICATE, message: "Authentication failed due to an account configuration issue." }`.
 * - On internal server error (database issue, bcrypt error): `{ success: false, operation: CRUDOperation.AUTHENTICATE, message: "An internal server error occurred..." }`.
 */
const authenticateUser = async (
  username: string,
  passwordAttempt: string
): Promise<UserCrudResult> => {

  const operation = CRUDOperation.AUTHENTICATE;

  // Check for null, undefined, empty strings, or non-string types for username
  if (!username || typeof username !== 'string' || username.trim() === '') {
    logger.warn(`${serviceLocation}: Attempt with invalid or empty username.`);
    return { success: false, operation, message: 'Invalid username or password.' };
  }

  // Check for null, undefined, or empty string for password (allow any characters)
  if (passwordAttempt === undefined || passwordAttempt === null || passwordAttempt === '') { // Explicitly check empty string
    logger.warn(`${serviceLocation}: Attempt for username "${username}" with missing or empty password.`);
    return { success: false, operation, message: 'Invalid username or password.' };
  }

  try {
    // 1. Find the user specifically by username
    // Use .select('+password') to ensure the password hash is retrieved especially if have schema-level settings that might exclude it by default.
    const user: IUserDocument | null = await userModel.findOne({ username: username }).select('+password');

    // 2. Handle case where username doesn't exist
    if (!user) {
      logger.warn(`${serviceLocation}: Authentication attempt failed for non-existent username: ${username}`);
      return { success: false, operation, message: 'Invalid username or password.' };
    }

    // Check if the user record retrieved actually has a valid password hash stored, protects against data corruption or improperly created user records.
    if (!user.password || typeof user.password !== 'string' || user.password.length === 0) {
      logger.error(`${serviceLocation}: User "${username}" found in DB but has a missing, null, or empty password hash. Cannot authenticate.`);
      return { success: false, operation, message: 'Authentication failed due to an account configuration issue.' };
    }

    // 3. Compare the provided password attempt with the stored hash
    const isMatch = await bcrypt.compare(passwordAttempt, user.password);

    // 4. Handle case where passwords don't match
    if (!isMatch) {
      logger.warn(`${serviceLocation}: Authentication attempt failed for username: ${username} (Incorrect password)`);
      return { success: false, operation, message: 'Invalid username or password.' };
    }

    // 5. Authentication successful!
    logger.info(`${serviceLocation}: Authentication successful for username: ${username}`);
    return { success: true, operation, user: toIUserSafe(user) };

  } catch (error: unknown) {
    LogError(error as Error, serviceLocation, `Error during authentication process for username ${username}.`);
    return { success: false, operation, message: 'An internal server error occurred during authentication.' };
  }
};

/* Project Section */
/* Project Collection Creation */

// Create dimension schema for use in project schema (Nest Depth: 1)
const projectDimensionSchema = new Schema({
  width: { type: Number, required: true }, // X dimension of the image
  height: { type: Number, required: true }, // Y dimension of the image
  slices: { type: Number, required: true }, // Z dimension of the image (if applicable)
  frames: { type: Number, required: false }, // T dimension of the image (if applicable)
}, { _id: false }); // Disable automatic creation of an _id field for this subdocument

// Create voxel size schema for use in project schema (Nest Depth: 1)
const projectVoxelsizeSchema = new Schema({
  x: { type: Number, required: true }, // Voxel size in the X dimension
  y: { type: Number, required: true }, // Voxel size in the Y dimension
  z: { type: Number, required: false }, // Voxel size in the Z dimension (if applicable)
  t: { type: Number, required: false }, // Voxel size in the T dimension (if applicable)
}, { _id: false }); // Disable automatic creation of an _id field for this subdocument

// Project Collection (Nest Depth: 0)
const projectSchema = new Schema<IProject>({
  // Identifiers
  // _id:  string; // MongoDB Object ID of the project
  userid: { type: String, required: true }, // MongoDB User ID of the user to whom the project belongs
  // User inputs
  name: { type: String, required: true }, // Name of the project
  originalfilename: { type: String, required: true }, // Original filename of the uploaded file
  isSaved: { type: Boolean, required: true, default: false }, // Indicates if the project is saved
  description: { type: String, required: false }, // Description of the project
  // File properties
  filename: { type: String, required: true }, // Server rename - e.g., userid_projid.nii - use new mongoose.Types.ObjectId() to pregenerate before creating document in DB
  filetype: { type: String, required: true, enum: Object.values(FileType) }, // MIME type of the file
  filesize: { type: Number, required: true }, // Size of the file in bytes
  filehash: { type: String, required: true }, // SHA256 hash of the file
  // Location-tracking
  basepath: { type: String, required: true }, // Base path for the file storage (e.g., S3 bucket URL)
  originalfilepath: { type: String, required: true }, // Original (nifti/dicom) file location (e.g., S3 bucket URL)
  extractedfolderpath: { type: String, required: true }, // Folder path for the extracted files (e.g., S3 bucket URL)

  // File specifics
  datatype: { type: String, required: true }, // Data type of the image (e.g., uint8, float32)
  dimensions: { type: projectDimensionSchema, required: true }, // Dimensions of the image (e.g., width, height, slices, frames)
  // Voxel size (future proofing for 3D segmentation)
  voxelsize: { type: projectVoxelsizeSchema, required: false }, // Voxel size of the image (e.g., x, y, z, t dimensions) - check for errors in the future (stored in nifti as pixdim = [?, 0.5, 0.5, 1.0, 2.0, 0, 0, 0])
  // Affine transformation matrix (4x4) from NIfTI header for export functionality
  affineMatrix: { type: [[Number]], required: false }, // 4x4 affine transformation matrix from NIfTI header (optional, for avoiding re-downloads during export)
}, { timestamps: true }); // Automatically add createdAt and updatedAt timestamps
// Hooks for pre-save and pre-delete operations (must be before the model creation)
// Add validation to ensure userid exists before saving the project
projectSchema.pre('save', async function (next) {
  const userExists = await userModel.exists({ _id: this.userid });
  if (!userExists) {
    throw new Error('Referenced user does not exist');
  }
  next();
});
// When a project is deleted, delete ALL associated segmentation masks AND reconstructions
// THE S3 FILES STILL EXIST, API SIDE?
projectSchema.pre('deleteOne', { document: true, query: false }, async function (next) {
  const serviceLocationCascade = `${serviceLocation} - Project Delete Hook`;
  try {
    logger.info(`${serviceLocation}: Cascade delete triggered for project ${this._id}`);
    
    // Delete all reconstructions associated with this project first
    const reconstructionDeleteResult = await projectReconstructionModel.deleteMany({ projectid: this._id });
    logger.info(`${serviceLocation}: Deleted ${reconstructionDeleteResult.deletedCount} reconstructions for project ${this._id}`);
    
    // Delete all masks associated with this project
    const maskDeleteResult = await projectSegmentationMaskModel.deleteMany({ projectid: this._id });
    logger.info(`${serviceLocation}: Deleted ${maskDeleteResult.deletedCount} segmentation masks for project ${this._id}`);
    
    // Delete all inference jobs (segmentation/reconstruction) associated with this project
    const jobDeleteResult = await jobModel.deleteMany({ projectid: this._id });
    logger.info(`${serviceLocation}: Deleted ${jobDeleteResult.deletedCount} inference jobs for project ${this._id}`);
    
    next(); // Proceed to project deletion
  } catch (error: unknown) {
    LogError(error as Error, serviceLocationCascade, `Error during cascade delete for project ${this._id}.`);
    // Halt the original project deletion by passing the error
    next(error instanceof Error ? error : new Error('Failed to cascade delete segmentation masks, reconstructions, and inference jobs'));
  }
});
// Create the model with proper typing
const projectModel = model<IProject, Model<IProject>>("Project", projectSchema);

// Add project indexes after model creation
projectSchema.index({ userid: 1, name: 1 }, { unique: true }); // Unique index on userid and name

// Project Segmentation Mask Collection
// Create segmentation mask content schema for use in project segmentation mask schema (Nest Depth: 3)
const projectSegmentationMaskSliceContentSchema = new Schema({
  class: { type: String, required: true, enum: Object.values(ComponentBoundingBoxesClass) }, // Class of the bounding box (rv, myo, lvc)
  segmentationmaskcontents: { type: String, required: false }, // Segmentation mask content. Changed required to false.
}, { _id: false }); // Disable automatic creation of an _id field for this subdocument

// Create bounding box schema for use in project segmentation mask schema's slice schema (Nest Depth: 3)
const projectSegmentationMaskSliceComponentBoundingBoxesSchema = new Schema({
  class: { type: String, required: true, enum: Object.values(ComponentBoundingBoxesClass) }, // Class of the bounding box (rv, myo, lvc)
  confidence: { type: Number, required: true }, // Confidence score of the bounding box
  x_min: { type: Number, required: true }, // Minimum X coordinate of the bounding box
  y_min: { type: Number, required: true }, // Minimum Y coordinate of the bounding box
  x_max: { type: Number, required: true }, // Maximum X coordinate of the bounding box
  y_max: { type: Number, required: true }, // Maximum Y coordinate of the bounding box
}, { _id: false }); // Disable automatic creation of an _id field for this subdocument

// Create slice schema (Nest Depth: 2)
const projectSegmentationMaskSliceSchema = new Schema({
  sliceindex: { type: Number, required: true }, // Index of the slice (0-based)
  componentboundingboxes: [{ type: projectSegmentationMaskSliceComponentBoundingBoxesSchema, required: false }], // Array of component bounding boxes for the slicesegmentation mask image (e.g., S3 bucket URL) - assume CSV? or RLE?
  segmentationmasks: [{ type: projectSegmentationMaskSliceContentSchema, required: false }], // Array of segmentation masks for the frame
}, { _id: false }); // Disable automatic creation of an _id field for this subdocument

// Create frames schema (Nest Depth: 1)
const projectSegmentationMaskFramesSchema = new Schema({
  frameindex: { type: Number, required: true }, // Index of the frame (0-based)
  frameinferred: { type: Boolean, required: true, default: false }, // Indicates if the frame is inferred (update if user runs MedSAM on the frame)
  slices: { type: [projectSegmentationMaskSliceSchema], required: true }, // Array of slices for the frame
}, { _id: false }); // Disable automatic creation of an _id field for this subdocument

// Create Segmentation mask schema (Nest Depth: 0)
const projectSegmentationMaskSchema = new Schema<IProjectSegmentationMask>({
  // Identifiers
  projectid: { type: String, required: true }, // MongoDB Project ID of the project to which the segmentation mask belongs
  // User inputs
  name: { type: String, required: true }, // Name of the segmentation mask
  description: { type: String, required: false }, // Description of the segmentation mask
  isSaved: { type: Boolean, required: true, default: false }, // Indicates if the segmentation mask is saved
  segmentationmaskRLE: { type: Boolean, required: false }, // RLE of the segmentation mask (e.g., S3 bucket URL)
  isMedSAMOutput: { type: Boolean, required: true, default: false }, // Indicates if the segmentation mask is a MedSAM output
  // Properties of extracted folder + location tracking
  // Index should be 0 based
  frames: [{ type: projectSegmentationMaskFramesSchema, required: true }], // Array of frames for the segmentation mask
}, { timestamps: true }); // Automatically add createdAt and updatedAt timestamps

// Create the model with proper typing
// Hooks for pre-save and pre-delete operations (must be before the model creation)
// Add validation to ensure projectid exists before saving
projectSegmentationMaskSchema.pre('save', async function (next) {
  const projectExists = await projectModel.exists({ _id: this.projectid });
  if (!projectExists) {
    throw new Error('Referenced project does not exist');
  }
  next();
});
const projectSegmentationMaskModel = model<IProjectSegmentationMask, Model<IProjectSegmentationMask>>("Segmentation Masks", projectSegmentationMaskSchema);

// Add segmentation mask indexes after model creation  
projectSegmentationMaskSchema.index({ projectid: 1 }); // Index on project ID for segmentation masks

// Project Reconstruction Collection
// Create simplified Project 4D Reconstruction schema for AI SDF-based reconstruction
const projectReconstructionSchema = new Schema<IProjectReconstructionDocument>({
  // Identifiers
  projectid: { type: String, required: true }, // MongoDB Project ID of the project to which the reconstruction belongs
  maskId: { type: String, required: false }, // MongoDB Segmentation Mask ID used for reconstruction (optional for GPU-generated reconstructions)
  
  // User inputs
  name: { type: String, required: true }, // Name of the reconstruction
  description: { type: String, required: false }, // Description of the reconstruction
  ed_frame: { type: Number, required: true, default: 1 }, // End-diastole frame number for reconstruction
  isSaved: { type: Boolean, required: true, default: false }, // Indicates if the reconstruction is saved
  isAIGenerated: { type: Boolean, required: true, default: false }, // Indicates if the reconstruction is AI generated
  meshFormat: { type: String, required: true, enum: Object.values(MeshFormat) }, // Format of the mesh file
  
  // File properties
  filename: { type: String, required: true }, // Server-generated unique filename
  filesize: { type: Number, required: true }, // Size of the reconstruction file in bytes
  filehash: { type: String, required: true }, // Hash of the reconstruction file for integrity verification
  
  // Location tracking
  basepath: { type: String, required: true }, // Base path for the reconstruction storage (e.g., S3 bucket URL)
  reconstructionfolderpath: { type: String, required: true }, // Folder path for the reconstruction file (e.g., S3 bucket URL)
  
  // 4D Reconstruction Mesh - single mesh file from AI SDF model
  reconstructedMesh: {
    path: { type: String, required: true }, // S3 path to the mesh file
    filename: { type: String, required: true }, // Mesh filename (e.g., projectid_reconstructionid_4d.npz)
    filesize: { type: Number, required: true }, // Size of mesh file in bytes
    hash: { type: String, required: true }, // SHA256 hash of mesh file
    format: { type: String, required: true }, // Mesh file format (npz, obj, glb)
    meshData: { type: String, required: false }, // Base64 encoded mesh data from GPU callback (optional)
    reconstructionTime: { type: Number, required: false }, // Time taken for reconstruction in seconds (optional)
    numIterations: { type: Number, required: false }, // Number of iterations used in SDF reconstruction (optional)
    resolution: { type: Number, required: false }, // Resolution of the reconstruction grid (optional)
  },
}, { timestamps: true }); // Automatically add createdAt and updatedAt timestamps

// Hooks for pre-save and pre-delete operations (must be before the model creation)
// Add validation to ensure projectid exists before saving the reconstruction
projectReconstructionSchema.pre('save', async function (next) {
  const projectExists = await projectModel.exists({ _id: this.projectid });
  if (!projectExists) {
    throw new Error('Referenced project does not exist');
  }
  
  // Validate that maskId exists and belongs to the same project (only if maskId is provided)
  if (this.maskId) {
    const maskExists = await projectSegmentationMaskModel.findOne({ 
      _id: this.maskId,
      projectid: this.projectid 
    });
    if (!maskExists) {
      throw new Error('Referenced segmentation mask does not exist or does not belong to the same project');
    }
  }
  
  // Validate reconstruction mesh data consistency
  if (this.reconstructedMesh) {
    // Validate required mesh properties
    const requiredStringFields = ['path', 'filename', 'hash', 'format'];
    for (const field of requiredStringFields) {
      if (!this.reconstructedMesh[field as keyof typeof this.reconstructedMesh] || 
          typeof this.reconstructedMesh[field as keyof typeof this.reconstructedMesh] !== 'string') {
        throw new Error(`reconstructedMesh.${field} is required and must be a non-empty string`);
      }
    }
    
    // Validate filesize
    if (typeof this.reconstructedMesh.filesize !== 'number' || this.reconstructedMesh.filesize < 0) {
      throw new Error('reconstructedMesh.filesize must be a non-negative number');
    }
  }
  
  next();
});

// Create the model with proper typing
const projectReconstructionModel = model<IProjectReconstructionDocument, Model<IProjectReconstructionDocument>>("4D reconstructions", projectReconstructionSchema);

// Add reconstruction indexes BEFORE model creation for better performance
projectReconstructionSchema.index({ maskId: 1 }); // Index on mask ID for performance
projectReconstructionSchema.index({ projectid: 1, maskId: 1 }); // Compound index for project-mask queries (also covers projectid-only queries)
projectReconstructionSchema.index({ projectid: 1, name: 1 }, { unique: true }); // Unique index on project ID and name (also covers projectid-only queries)

/**
 * Creates a new project record in the database.
 * Performs checks to ensure uniqueness constraints are met before creation.
 * Uniqueness checks include:
 * - Project name must be unique per user.
 * - File hash must be unique per user.
 * - Original file path must be globally unique.
 * - Extracted folder path must be globally unique.
 * - Server-generated filename must be globally unique.
 * 
 * @async
 * @function createProject
 * @param {string} userid - The ID of the user creating the project.
 * @param {string} name - The name for the new project (must be unique for this user).
 * @param {string} originalfilename - The original name of the uploaded file.
 * @param {string} description - A user-provided description for the project (optional).
 * @param {boolean} isSaved - Indicates if the file should be saved (true) or not (false).
 * @param {string} filename - The server-generated unique filename, preferably using the format `userid_filehash.nii` as ObjectId has not been generated yet.
 * @param {FileType} filetype - The MIME type of the uploaded file.
 * @param {number} filesize - The size of the uploaded file in bytes.
 * @param {string} filehash - The SHA256 hash of the uploaded file content.
 * @param {string} basepath - The base storage path (e.g., S3 bucket URL).
 * @param {string} originalfilepath - The unique path/key where the original file is stored.
 * @param {string} extractedfolderpath - The unique path/key to the folder where extracted files (e.g., JPEGs) will be stored.
 * @param {FileDataType} datatype - The data type of the image pixels (e.g., float32, uint8).
 * @param {object} dimensions - The dimensions of the image.
 * @param {number} dimensions.width - Image width in pixels.
 * @param {number} dimensions.height - Image height in pixels.
 * @param {number} dimensions.slices - Number of slices (depth).
 * @param {number} [dimensions.frames] - Optional number of time frames (for 4D data).
 * @param {object} [voxelsize] - Optional physical voxel dimensions.
 * @param {number} voxelsize.x - Voxel size in the x-dimension (mm).
 * @param {number} voxelsize.y - Voxel size in the y-dimension (mm).
 * @param {number} [voxelsize.z] - Optional voxel size in the z-dimension (mm).
 * @param {number} [voxelsize.t] - Optional voxel size in the t-dimension (e.g., seconds).
 * @param {string} [description] - Optional description for the project.
 * @returns {Promise<ProjectCrudResult>} A promise resolving to a ProjectCrudResult object.
 * - On success: `{ success: true, operation: CRUDOperation.CREATE, project: IProjectDocument }`
 * - On uniqueness conflict: `{ success: false, operation: CRUDOperation.CREATE, message: string }` detailing the conflict.
 * - On database error: `{ success: false, operation: CRUDOperation.CREATE, message: "Error creating project." }`
 */
const createProject = async (
  userid: string,
  name: string, // User-given name of the project (must be unique for the user)
  originalfilename: string, // The original name of the file when uploaded
  description: string, // User-given description of the project (optional)
  isSaved: boolean, // Indicates if the file should be saved (true) or not (false)
  filename: string, // server generated filename in the format of userid_filehash.nii (e.g., 1234567890_2630fcede25328c13a15c4dfe6376c068201eb1f8d871736cd8197c2b1463ed3.nii)
  filetype: FileType, // MIME type of the file (e.g., image/nifti, image/dicom) - should be detected by server
  filesize: number, // In bytes
  filehash: string, // SHA256 hash of the file (to be generated by the API developers)
  basepath: string, // Base path for the file storage (e.g., S3 bucket URL)
  originalfilepath: string, // Original file location (e.g., S3 bucket URL)
  extractedfolderpath: string, // Folder path for the extracted files (e.g., S3 bucket URL)
  datatype: FileDataType, // Data type of the image (e.g., uint8, float32) - should be detected by server
  dimensions: { width: number; height: number; slices: number; frames?: number },
  voxelsize?: { x: number; y: number; z?: number; t?: number }, // Optional physical voxel dimensions (e.g., x, y, z, t dimensions) - should be detected by server
  affineMatrix?: number[][], // Optional 4x4 affine transformation matrix from NIfTI header
): Promise<ProjectCrudResult> => {
  const operation = CRUDOperation.CREATE;
  try {
    // If user does not exist, return error
    const user = await userModel.findById(userid);
    if (!user) {
      logger.warn(`${serviceLocation}: User ${userid} does not exist.`);
      return { success: false, operation, message: `User ${userid} does not exist.` };
    }

    // Validate input parameters
    // Check if all the string inputs are non-empty strings
    const stringInputs = [userid, name, originalfilename, filename, filehash, basepath, originalfilepath, extractedfolderpath, datatype];
    const emptyStringInputs = stringInputs.filter(input => !input || typeof input !== 'string' || input.trim() === '');
    if (emptyStringInputs.length > 0) {
      logger.warn(`${serviceLocation}: Invalid input parameters for project creation: ${emptyStringInputs.join(", ")}`);
      return { success: false, operation, message: `Invalid input parameters for project creation: ${emptyStringInputs.join(", ")}` };
    }
    // Check if the numeric inputs are valid numbers
    if (isNaN(filesize) || isNaN(dimensions.width) || isNaN(dimensions.height) || isNaN(dimensions.slices)) {
      logger.warn(`${serviceLocation}: Invalid numeric input parameters for project creation: ${JSON.stringify({ filesize, dimensions })}`);
      return { success: false, operation, message: `Invalid numeric input parameters for project creation.` };
    }
    // Check if all numeric inputs are more than 0
    const numericInputs = [filesize, dimensions.width, dimensions.height, dimensions.slices];
    const negativeNumericInputs = numericInputs.filter(input => input <= 0);
    if (negativeNumericInputs.length > 0) {
      logger.warn(`${serviceLocation}: Invalid numeric input parameters for project creation: ${negativeNumericInputs.join(", ")}`);
      return { success: false, operation, message: `Invalid numeric input parameters for project creation.` };
    }
    // Check that voxelSize inputs are more than 0 if provided
    if (voxelsize) {
      // Only validate that x and y are positive (required spatial dimensions)
      // z and t can be 0 for 2D images or single frame data
      const requiredVoxelInputs = [voxelsize.x, voxelsize.y].filter(input => (input ?? 0) <= 0);
      const optionalVoxelInputs = [voxelsize.z, voxelsize.t].filter(input => input !== undefined && input < 0);

      if (requiredVoxelInputs.length > 0) {
        logger.warn(`${serviceLocation}: Invalid required voxel size input parameters (x, y) for project creation: ${requiredVoxelInputs.join(", ")}`);
        return { success: false, operation, message: `Invalid required voxel size input parameters for project creation.` };
      }

      if (optionalVoxelInputs.length > 0) {
        logger.warn(`${serviceLocation}: Invalid optional voxel size input parameters (z, t) for project creation: ${optionalVoxelInputs.join(", ")}`);
        return { success: false, operation, message: `Invalid optional voxel size input parameters for project creation.` };
      }
    }

    // Check conflicting fields (name, filehash, originalfilepath, extractedfolderpath, filename) 
    const existingProject = await projectModel.findOne({
      $or: [
        { userid: userid, name: name }, // User must not have a project with the same name
        { userid: userid, filehash: filehash }, // User must not have a project with the same filehash
        { originalfilepath: originalfilepath },
        { extractedfolderpath: extractedfolderpath },
        { filename: filename },
      ],
    });
    // If conflicts found, aggregate reasons and return error
    if (existingProject) {
      let reasons = `Project creation failed due to uniqueness constraint violation:`; // Starting error message
      if (existingProject.userid === userid && existingProject.name === name) reasons += ` Name "${name}" already exists for this user.`;
      if (existingProject.userid === userid && existingProject.filehash === filehash) reasons += ` File hash "${filehash}" already exists for this user.`;
      if (existingProject.originalfilepath === originalfilepath) reasons += ` Original filepath "${originalfilepath}" is already in use globally.`;
      if (existingProject.extractedfolderpath === extractedfolderpath) reasons += ` Extracted folder path "${extractedfolderpath}" is already in use globally.`;
      if (existingProject.filename === filename) reasons += ` Server filename "${filename}" is already in use globally.`;
      logger.warn(`${serviceLocation}: Error creating project: ${reasons}`);
      return { success: false, operation, message: reasons };
    }

    // Create new project instance
    const newProject: IProjectDocument = new projectModel({
      userid: userid,
      name: name,
      originalfilename: originalfilename,
      description: description, // Optional
      isSaved: isSaved,
      filename: filename,
      filetype: filetype,
      filesize: filesize,
      filehash: filehash,
      basepath: basepath,
      originalfilepath: originalfilepath,
      extractedfolderpath: extractedfolderpath,
      datatype: datatype,
      dimensions: dimensions,
      voxelsize: voxelsize, // Optional
      affineMatrix: affineMatrix, // Optional 4x4 affine transformation matrix
    });
    // Save the new project to the database
    await newProject.save();

    logger.info(`${serviceLocation}: Project ${newProject._id} created successfully: ${newProject.name}, ${newProject.originalfilename}, ${newProject.filename}, ${newProject.filehash}`);
    return { success: true, operation, project: newProject }; // Return the created project
  } catch (error: unknown) {
    LogError(error as Error, serviceLocation, `Error creating project.`);
    return { success: false, operation: CRUDOperation.CREATE, message: "Error creating project." };
  }
}

/**
 * Reads/searches for projects in the database based on various optional criteria.
 * Dynamically constructs a MongoDB query based on the provided parameters.
 * Supports filtering by ID, user, name (case-insensitive), description (case-insensitive),
 * saved status, filename (case-insensitive), file types (array), file size range,
 * data types (array), dimension ranges (AND logic), voxel size ranges (OR logic),
 * and creation date range.
 *
 * @async
 * @function readProject
 * @param {string} [projectid] - Optional project ID to find a specific project.
 * @param {string} [userid] - Optional user ID to filter projects by owner.
 * @param {string} [name] - Optional project name fragment for case-insensitive search.
 * @param {string} [description] - Optional description fragment for case-insensitive search.
 * @param {boolean} [isSaved] - Optional boolean to filter by saved status.
 * @param {string} [filename] - Optional filename fragment for case-insensitive search.
 * @param {FileType[]} [filetype] - Optional array of file types (e.g., [FileType.NIFTI]) to filter by.
 * @param {object} [filesize] - Optional object defining a file size range.
 * @param {number} [filesize.minsize] - Minimum file size (inclusive).
 * @param {number} [filesize.maxsize] - Maximum file size (inclusive).
 * @param {string} [filehash] - Optional file hash to filter by (exact match).
 * @param {FileDataType[]} [datatype] - Optional array of data types to filter by.
 * @param {object} [dimensions] - Optional object defining dimension ranges. All provided dimension ranges must be met (AND logic).
 * @param {object} [dimensions.width] - Width range { minsize?, maxsize? }.
 * @param {object} [dimensions.height] - Height range { minsize?, maxsize? }.
 * @param {object} [dimensions.slices] - Slices range { minsize?, maxsize? }.
 * @param {object} [dimensions.frames] - Frames range { minsize?, maxsize? }.
 * @param {object} [voxelsize] - Optional object defining voxel size ranges. At least one provided voxel size range must be met (OR logic).
 * @param {object} [voxelsize.x] - Voxel X range { minsize?, maxsize? }.
 * @param {object} [voxelsize.y] - Voxel Y range { minsize?, maxsize? }.
 * @param {object} [voxelsize.z] - Voxel Z range { minsize?, maxsize? }.
 * @param {object} [voxelsize.t] - Voxel T range { minsize?, maxsize? }.
 * @param {object} [daterange] - Optional object defining a creation date range.
 * @param {Date} [daterange.start] - Start date (inclusive).
 * @param {Date} [daterange.end] - End date (inclusive).
 * @returns {Promise<ProjectCrudResult>} A promise resolving to a ProjectCrudResult object.
 * - On success with results: `{ success: true, operation: CRUDOperation.READ, projects: IProjectDocument[] }`.
 * - On success with no results: `{ success: true, operation: CRUDOperation.READ, message: "No projects found..." }`.
 * - On error: `{ success: false, operation: CRUDOperation.READ, message: "Error reading projects." }`.
 */
const readProject = async (
  projectid?: string,
  userid?: string,
  name?: string,
  description?: string,
  isSaved?: boolean,
  filename?: string,
  filetype?: FileType[], // array of file types to filter by (e.g., [FileType.NIFTI, FileType.DICOM])
  filesize?: { minsize?: number; maxsize?: number },
  filehash?: string, // exact match for file hash
  datatype?: FileDataType[],
  dimensions?: { width?: { minsize?: number; maxsize?: number }, height?: { minsize?: number; maxsize?: number }, slices?: { minsize?: number; maxsize?: number }, frames?: { minsize?: number; maxsize?: number }, },
  voxelsize?: { x?: { minsize?: number; maxsize?: number }, y?: { minsize?: number; maxsize?: number }, z?: { minsize?: number; maxsize?: number }, t?: { minsize?: number; maxsize?: number }, },
  daterange?: { start?: Date; end?: Date },
): Promise<ProjectCrudResult> => {
  const operation = CRUDOperation.READ;
  // validate input parameters
  const searchConditions: object[] = []; // Array to hold search conditions for the query
  if (projectid) searchConditions.push({ _id: projectid }); // Search by project ID
  if (userid) searchConditions.push({ userid: userid }); // Search by user ID
  if (name) searchConditions.push({ name: { $regex: new RegExp(name, 'i') } }); // Case-insensitive search by name
  if (description) searchConditions.push({ description: { $regex: new RegExp(description, 'i') } }); // Case-insensitive search by description
  if (isSaved !== undefined) searchConditions.push({ isSaved: isSaved }); // Search by saved status
  if (filename) searchConditions.push({ filename: { $regex: new RegExp(filename, 'i') } }); // Case-insensitive search by filename
  if (filetype) searchConditions.push({ filetype: { $in: filetype } }); // Search by file type
  if (filesize) {
    if (filesize.minsize) searchConditions.push({ filesize: { $gte: filesize.minsize } }); // Search by minimum file size
    if (filesize.maxsize) searchConditions.push({ filesize: { $lte: filesize.maxsize } }); // Search by maximum file size
  }
  if (filehash) searchConditions.push({ filehash: filehash }); // Search by file hash
  if (datatype) searchConditions.push({ datatype: { $in: datatype } }); // Search by data type
  if (dimensions) searchConditions.push({
    $and: [
      dimensions.width?.minsize ? { 'dimensions.width': { $gte: dimensions.width.minsize } } : {},
      dimensions.width?.maxsize ? { 'dimensions.width': { $lte: dimensions.width.maxsize } } : {},
      dimensions.height?.minsize ? { 'dimensions.height': { $gte: dimensions.height.minsize } } : {},
      dimensions.height?.maxsize ? { 'dimensions.height': { $lte: dimensions.height.maxsize } } : {},
      dimensions.slices?.minsize ? { 'dimensions.slices': { $gte: dimensions.slices.minsize } } : {},
      dimensions.slices?.maxsize ? { 'dimensions.slices': { $lte: dimensions.slices.maxsize } } : {},
      dimensions.frames?.minsize ? { 'dimensions.frames': { $gte: dimensions.frames.minsize } } : {},
      dimensions.frames?.maxsize ? { 'dimensions.frames': { $lte: dimensions.frames.maxsize } } : {},
    ]
  });
  if (voxelsize) searchConditions.push({
    $or: [
      voxelsize.t?.minsize ? { 'voxelsize.t': { $gte: voxelsize.t.minsize } } : {},
      voxelsize.t?.maxsize ? { 'voxelsize.t': { $lte: voxelsize.t.maxsize } } : {},

      voxelsize.x?.minsize ? { 'voxelsize.x': { $gte: voxelsize.x.minsize } } : {},
      voxelsize.x?.maxsize ? { 'voxelsize.x': { $lte: voxelsize.x.maxsize } } : {},

      voxelsize.y?.minsize ? { 'voxelsize.y': { $gte: voxelsize.y.minsize } } : {},
      voxelsize.y?.maxsize ? { 'voxelsize.y': { $lte: voxelsize.y.maxsize } } : {},

      voxelsize.z?.minsize ? { 'voxelsize.z': { $gte: voxelsize.z.minsize } } : {},
      voxelsize.z?.maxsize ? { 'voxelsize.z': { $lte: voxelsize.z.maxsize } } : {},

    ]
  });
  if (daterange) {
    if (daterange.start) searchConditions.push({ createdAt: { $gte: daterange.start } }); // Search by start date
    if (daterange.end) searchConditions.push({ createdAt: { $lte: daterange.end } }); // Search by end date
  }
  // If no search conditions are provided, return all projects
  if (searchConditions.length === 0) {
    logger.warn(`${serviceLocation}: No search conditions provided. Returning all projects.`);
    // Remove .lean() to return Mongoose documents (IProjectDocument) instead of plain objects
    return { success: true, operation, projects: await projectModel.find({}) }; // Return all projects as Mongoose documents
  }

  // If there are search conditions, build the query
  const query = { $and: searchConditions }; // Combine all conditions with $and
  logger.info(`${serviceLocation}: Reading projects matching query: ${JSON.stringify(query)}`);

  try {
    const projects = await projectModel.find(query); // Execute the query

    if (projects.length === 0) {
      logger.info(`${serviceLocation}: No projects found matching the criteria.`);
      return { success: true, operation, message: "No projects found matching the criteria." };
    }

    logger.info(`${serviceLocation}: Found ${projects.length} projects matching the criteria.`);
    return { success: true, operation, projects: projects }; // Return found projects as Mongoose documents

  } catch (error: unknown) {
    LogError(error as Error, serviceLocation, `Error reading projects with query: ${JSON.stringify(query)}`);
    return { success: false, operation, message: "Error reading projects." };
  }
}

// updateProject function
const updateProject = async (
  // Identifying parameters:
  projectid: string, // The ID of the project to update (unique)
  // Update object
  updates: {
    userid?: string,
    name?: string, // User-given name of the project (must be unique for the user)
    originalfilename?: string, // The original name of the file when uploaded
    isSaved?: boolean, // Indicates if the file should be saved (true) or not (false)
    filename?: string, // server generated filename in the format of userid_filehash.nii (e.g., 1234567890_2630fcede25328c13a15c4dfe6376c068201eb1f8d871736cd8197c2b1463ed3.nii)
    filetype?: FileType, // MIME type of the file (e.g., image/nifti, image/dicom) - should be detected by server
    filesize?: number, // In bytes
    filehash?: string, // SHA256 hash of the file (to be generated by the API developers)
    basepath?: string, // Base path for the file storage (e.g., S3 bucket URL)
    originalfilepath?: string, // Original file location (e.g., S3 bucket URL)
    extractedfolderpath?: string, // Folder path for the extracted files (e.g., S3 bucket URL)
    datatype?: FileDataType, // Data type of the image (e.g., uint8, float32) - should be detected by server
    dimensions?: { width?: number; height?: number; slices?: number; frames?: number },
    voxelsize?: { x?: number; y?: number; z?: number; t?: number }, // Optional physical voxel dimensions (e.g., x, y, z, t dimensions) - should be detected by server
    description?: string, // User-given description of the project (optional)
  }
): Promise<ProjectCrudResult> => {
  const operation = CRUDOperation.UPDATE;
  // Look for the project by id
  const project = await projectModel.findById(projectid);
  if (!project) {
    logger.warn(`${serviceLocation}: Project ${projectid} not found.`);
    return { success: false, operation, message: `Project ${projectid} not found.` };
  }
  try {
    if (updates.userid) project.userid = updates.userid; // Update user ID if provided
    if (updates.name) project.name = updates.name; // Update project name if provided
    if (updates.originalfilename) project.originalfilename = updates.originalfilename;
    if (updates.isSaved !== undefined) project.isSaved = updates.isSaved; // Update saved status if provided
    if (updates.filename) project.filename = updates.filename; // Update server filename if provided
    if (updates.filetype) project.filetype = updates.filetype; // Update file type if provided
    if (updates.filesize) project.filesize = updates.filesize; // Update file size if provided
    if (updates.filehash) project.filehash = updates.filehash; // Update file hash if provided
    if (updates.basepath) project.basepath = updates.basepath; // Update base path if provided
    if (updates.originalfilepath) project.originalfilepath = updates.originalfilepath; // Update original file path if provided
    if (updates.extractedfolderpath) project.extractedfolderpath = updates.extractedfolderpath; // Update extracted folder path if provided
    if (updates.datatype) project.datatype = updates.datatype; // Update data type if provided
    // Dimensions updates
    if (updates.dimensions) {
      if (updates.dimensions.width) project.dimensions.width = updates.dimensions.width;
      if (updates.dimensions.height) project.dimensions.height = updates.dimensions.height;
      if (updates.dimensions.slices) project.dimensions.slices = updates.dimensions.slices;
      if (updates.dimensions.frames) project.dimensions.frames = updates.dimensions.frames;
    }
    // Voxel size updates
    if (updates.voxelsize) {
      // Initialize voxelsize object if it doesn't exist
      if (!project.voxelsize) {
        project.voxelsize = { x: 0, y: 0 }; // Initialize with required fields
      }
      if (updates.voxelsize.x) project.voxelsize.x = updates.voxelsize.x;
      if (updates.voxelsize.y) project.voxelsize.y = updates.voxelsize.y;
      if (updates.voxelsize.z) project.voxelsize.z = updates.voxelsize.z;
      if (updates.voxelsize.t) project.voxelsize.t = updates.voxelsize.t;
    }
    if (updates.description) project.description = updates.description; // Update description if provided

    // Save the updated project to the database
    await project.save();

    logger.info(`${serviceLocation}: Project ${project._id} updated successfully.`);
    return { success: true, operation, project: project }; // Return the updated project
  } catch (error: unknown) {
    LogError(error as Error, serviceLocation, `Error updating project ${projectid} with error: ${error}.`);
    return { success: false, operation, message: "Error updating project." };
  }
}

/**
 * Deletes a project from the database by ID, triggering cascade deletion of all associated segmentation masks.
 * 
 * @async
 * @function deleteProject
 * @param {string} projectid - The ID of the project to delete
 * @returns {Promise<ProjectCrudResult>} Result object with success status, operation type, and message
 * - Success: {success: true, operation: DELETE, message: "Project deleted successfully"}
 * - Not found: {success: false, operation: DELETE, message: "Project not found"}
 * - Error: {success: false, operation: DELETE, message: "Error deleting project"}
 */
const deleteProject = async (projectid: string): Promise<ProjectCrudResult> => {
  const operation = CRUDOperation.DELETE;
  try {
    // Find the project by ID
    const project = await projectModel.findById(projectid);
    if (!project) {
      logger.warn(`${serviceLocation}: Project ${projectid} not found.`);
      return { success: false, operation, message: `Project ${projectid} not found.` };
    }
    // Delete the project
    await project.deleteOne();
    logger.info(`${serviceLocation}: Project ${project._id} deleted successfully.`);
    return { success: true, operation, message: `Project ${project._id} deleted successfully.` };
  } catch (error: unknown) {
    LogError(error as Error, serviceLocation, `Error deleting project ${projectid}.`);
    return { success: false, operation, message: "Error deleting project." };
  }
}

/* Project Segmentation Mask section */

/**
 * CODE CHANGED - JSDOCS MAY NOT BE ACCURATE
 * Creates a new project segmentation mask record in the database.
 * Validates the provided data, including checking for the existence of the referenced project ID,
 * ensuring string inputs are not empty, and numeric inputs (indices, coordinates) are non-negative.
 *
 * @async
 * @function createProjectSegmentationMask
 * @param {IProjectSegmentationMask} projectsegmentationmask - An object containing the details of the segmentation mask to create. Import this interface from the database's types file.
 * @returns {Promise<ProjectSegmentationMaskCrudResult>} A promise resolving to a ProjectSegmentationMaskCrudResult object.
 * - On success: `{ success: true, operation: CREATE, projectsegmentationmask: IProjectSegmentationMaskDocument }` containing the created mask document.
 * - On failure (project not found): `{ success: false, operation: CREATE, message: "Project ID ... does not exist." }`.
 * - On failure (invalid input): `{ success: false, operation: CREATE, message: "Invalid input parameters..." }`.
 * - On database error: `{ success: false, operation: CREATE, message: "Error creating project segmentation mask." }`.
 */
const createProjectSegmentationMask = async (
  projectsegmentationmask: IProjectSegmentationMask
): Promise<ProjectSegmentationMaskCrudResult> => {
  const operation = CRUDOperation.CREATE;
  const psm = projectsegmentationmask;
  try {
    const projectid = projectsegmentationmask.projectid;
    const projectidexists = await projectModel.exists({ _id: projectid });
    if (!projectidexists) {
      logger.warn(`${serviceLocation}: Project ID ${projectid} does not exist.`);
      return { success: false, operation, message: `Project ID ${projectid} does not exist.` };
    }
    const projectsegmasknameexists = await projectSegmentationMaskModel.exists({ name: psm.name, projectid: psm.projectid })
    if (projectsegmasknameexists) {
      logger.warn(`${serviceLocation}: Invalid input parameters for project segmentation mask creation: Segmentation mask name ${psm.name} already exists for this project.`);
      return { success: false, operation, message: `Invalid input parameters for project segmentation mask creation: Segmentation mask name ${psm.name} already exists for this project.` };
    }
    const stringInputs = [
      psm.name,
    ]
    const emptyStringInputs = stringInputs.filter(input => !input || typeof input !== 'string' || input.trim() === '');
    if (emptyStringInputs.length > 0) {
      logger.warn(`${serviceLocation}: Invalid input parameters for project segmentation mask creation: ${emptyStringInputs.join(", ")}`);
      return { success: false, operation, message: `Invalid input parameters for project segmentation mask creation: ${emptyStringInputs.join(", ")}` };
    }
    const numericInputs = [
      ...psm.frames.flatMap(frame => frame.slices.map(slices => slices.sliceindex)),
      ...psm.frames.flatMap(frame => frame.frameindex),
      ...psm.frames.flatMap(frame => frame.slices.flatMap(slices => slices.componentboundingboxes?.map(box => box.x_min) || [])),
      ...psm.frames.flatMap(frame => frame.slices.flatMap(slices => slices.componentboundingboxes?.map(box => box.y_min) || [])),
      ...psm.frames.flatMap(frame => frame.slices.flatMap(slices => slices.componentboundingboxes?.map(box => box.x_max) || [])),
      ...psm.frames.flatMap(frame => frame.slices.flatMap(slices => slices.componentboundingboxes?.map(box => box.y_max) || [])),
    ].flat();
    const negativeNumericInputs = numericInputs.filter(input => typeof input === 'number' && input < 0);
    if (negativeNumericInputs.length > 0) {
      logger.warn(`${serviceLocation}: Invalid numeric input parameters for project segmentation mask creation: ${negativeNumericInputs.join(", ")}`);
      return { success: false, operation, message: `Invalid numeric input parameters for project segmentation mask creation.` };
    }
    const invalidBoundingBoxes = psm.frames.flatMap(frame => frame.slices.flatMap(slices => slices.componentboundingboxes?.filter(box => box.x_max < box.x_min || box.y_max < box.y_min) || []));
    if (invalidBoundingBoxes.length > 0) {
      const invalidBoundingBoxesResult = invalidBoundingBoxes.map(box => `(${box.x_min}, ${box.y_min}) to (${box.x_max}, ${box.y_max})`).join(", ");
      logger.warn(`${serviceLocation}: Invalid bounding box coordinates for project segmentation mask creation: ${invalidBoundingBoxesResult}`);
      return { success: false, operation, message: `Invalid bounding box coordinates for project segmentation mask creation: ${invalidBoundingBoxesResult}.` };
    }
    if (!psm.frames || !Array.isArray(psm.frames) || psm.frames.length === 0) {
      logger.warn(`${serviceLocation}: Invalid input parameters for project segmentation mask creation: frames array must be populated with at least one frame.`);
      return { success: false, operation, message: `Invalid input parameters for project segmentation mask creation: frames array must be populated with at least one frame.` };
    }

    for (const frame of psm.frames) {
      if (!frame.slices || !Array.isArray(frame.slices) || frame.slices.length === 0) {
        // ... return error ...
      }
      for (const slice of frame.slices) {
        if (slice.segmentationmasks && Array.isArray(slice.segmentationmasks)) {
          for (const maskEntry of slice.segmentationmasks) {
            // This validation ensures it's a string if present, and not null/undefined. Allows "".
            if (maskEntry.segmentationmaskcontents === null ||
              maskEntry.segmentationmaskcontents === undefined ||
              typeof maskEntry.segmentationmaskcontents !== 'string') {
              const offendingLocation = `frame ${frame.frameindex}, slice ${slice.sliceindex}, class ${maskEntry.class}`;
              const messageDetail = `segmentationmaskcontents must be a non-null string. Received: ${maskEntry.segmentationmaskcontents}`;
              logger.warn(`${serviceLocation}: Invalid input for project segmentation mask creation: ${messageDetail} in ${offendingLocation}.`);
              return {
                success: false,
                operation,
                message: `Invalid input for project segmentation mask creation: ${messageDetail} in ${offendingLocation}.`
              };
            }
          }
        }
      }
    }

    const newProjectSegmentationMask = new projectSegmentationMaskModel(psm);
    const result = await newProjectSegmentationMask.save();
    if (!result) {
      logger.warn(`${serviceLocation}: Error creating project segmentation mask.`);
      return { success: false, operation, message: "Error creating project segmentation mask." };
    }
    logger.info(`${serviceLocation}: Project segmentation mask ${result._id} created successfully.`);
    return { success: true, operation, projectsegmentationmask: result };
  } catch (error: unknown) {
    LogError(error as Error, serviceLocation, `Error creating project segmentation mask, ${error}`);
    return { success: false, operation, message: "Error creating project segmentation mask." };
  }
}
/**
 * Reads all segmentation masks associated with a specific project ID.
 * Validates the existence of the project ID before querying the database.
 *
 * @async
 * @function readProjectSegmentationMask
 * @param {string} projectid - The ID of the project whose segmentation masks are to be retrieved.
 * @returns {Promise<ProjectSegmentationMaskCrudResult>} A promise resolving to a ProjectSegmentationMaskCrudResult object.
 * - On success with results: `{ success: true, operation: CRUDOperation.READ, projectsegmentationmasks: IProjectSegmentationMaskDocument[] }`.
 * - On success with no results: `{ success: true, operation: CRUDOperation.READ, message: "No segmentation masks found for this project." }`.
 * - On failure (project not found): `{ success: false, operation: CRUDOperation.READ, message: "Project ID ... does not exist." }`.
 * - On database error: `{ success: false, operation: CRUDOperation.READ, message: "Error reading project segmentation mask." }`.
 */
const readProjectSegmentationMask = async (
  projectid: string,
): Promise<ProjectSegmentationMaskCrudResult> => {
  const operation = CRUDOperation.READ;
  try {
    // validate the project id
    const projectidexists = await projectModel.exists({ _id: projectid });
    if (!projectidexists) {
      logger.warn(`${serviceLocation}: Project ID ${projectid} does not exist.`);
      return { success: false, operation, message: `Project ID ${projectid} does not exist.` }; // Project ID does not exist
    }
    // Find all segmentation masks for the project
    const projectSegmentationMasks = await projectSegmentationMaskModel.find({ projectid: projectid });
    if (!projectSegmentationMasks || projectSegmentationMasks.length === 0) {
      logger.info(`${serviceLocation}: No segmentation masks found for project ID ${projectid}.`);
      return { success: true, operation, message: "No segmentation masks found for this project." }; // true success, but no results found
    }
    logger.info(`${serviceLocation}: Found ${projectSegmentationMasks.length} segmentation masks for project ID ${projectid}.`);
    return { success: true, operation, projectsegmentationmasks: projectSegmentationMasks }; // Return the found segmentation masks

  } catch (error: unknown) {
    LogError(error as Error, serviceLocation, `Error reading project segmentation mask, ${error}`);
    return { success: false, operation, message: "Error reading project segmentation mask." };
  }
}

/**
 * CODE CHANGED - JSDOCS MAY NOT BE ACCURATE
 * Updates an existing project segmentation mask in the database.
 * Validates the existence of the mask ID and the project ID before applying updates.
 * Checks for uniqueness of the name and validates the contents of the mask.
 * Should be used for large updates, as it almost replaces the entire mask object (especially the frame).
 * 
 * @async
 * @function updateProjectSegmentationMask
 * @param {string} maskid - The ID of the segmentation mask to update.
 * @param {Partial<IProjectSegmentationMaskDocument>} maskupdates - An object containing the updates to apply to the segmentation mask.
 * * @returns {Promise<ProjectSegmentationMaskCrudResult>} A promise resolving to a ProjectSegmentationMaskCrudResult object.
 * - On success: `{ success: true, operation: CRUDOperation.UPDATE, projectsegmentationmask: IProjectSegmentationMaskDocument }` containing the updated mask document.
 * - On failure (mask not found): `{ success: false, operation: CRUDOperation.UPDATE, message: "Segmentation mask ID ... does not exist." }`.
 * - On failure (project not found): `{ success: false, operation: CRUDOperation.UPDATE, message: "Project ID ... does not exist." }`.
 * - On failure (invalid input): `{ success: false, operation: CRUDOperation.UPDATE, message: "Invalid input parameters..." }`.
 * - On database error: `{ success: false, operation: CRUDOperation.UPDATE, message: "Error updating project segmentation mask." }`.
 */
const updateProjectSegmentationMask = async (
  maskid: string,
  maskupdates: Partial<IProjectSegmentationMaskDocument>
): Promise<ProjectSegmentationMaskCrudResult> => {
  const operation = CRUDOperation.UPDATE;
  try {
    const mask = await projectSegmentationMaskModel.findById(maskid);
    if (!mask) {
      logger.warn(`${serviceLocation}: Project segmentation mask ${maskid} not found.`);
      return { success: false, operation, message: `Project segmentation mask ${maskid} not found.` };
    }

    if (maskupdates.name && maskupdates.name !== mask.name) {
      const nameExists = await projectSegmentationMaskModel.exists({
        projectid: mask.projectid,
        name: maskupdates.name,
        _id: { $ne: maskid }
      });
      if (nameExists) {
        return { success: false, operation, message: `Segmentation mask name '${maskupdates.name}' already exists for this project.` };
      }
      mask.name = maskupdates.name;
    }

    if (maskupdates.description !== undefined) {
      mask.description = maskupdates.description;
    }

    if (maskupdates.isSaved !== undefined) {
      mask.isSaved = maskupdates.isSaved;
    }

    if (maskupdates.isMedSAMOutput !== undefined) {
      mask.isMedSAMOutput = maskupdates.isMedSAMOutput;
    }

    if (maskupdates.segmentationmaskRLE !== undefined) {
      mask.segmentationmaskRLE = maskupdates.segmentationmaskRLE;
    }


    if (maskupdates.frames) {
      if (!Array.isArray(maskupdates.frames) || maskupdates.frames.length === 0) {
        return { success: false, operation, message: "Frames array must contain at least one frame." };
      }

      const invalidFrameIndices = maskupdates.frames.filter(frame =>
        frame.frameindex === undefined || typeof frame.frameindex !== 'number' || frame.frameindex < 0
      );
      if (invalidFrameIndices.length > 0) {
        const indices = invalidFrameIndices.map(f => f.frameindex).join(", ");
        return { success: false, operation, message: `Invalid frame indices: [${indices}]. Frame index must be a non-negative number.` };
      }

      const framesWithEmptySlices = maskupdates.frames.filter(frame =>
        !frame.slices || !Array.isArray(frame.slices) || frame.slices.length === 0
      );
      if (framesWithEmptySlices.length > 0) {
        const indices = framesWithEmptySlices.map(f => f.frameindex).join(", ");
        return { success: false, operation, message: `Frames with indices [${indices}] must have at least one slice.` };
      }

      for (const frame of maskupdates.frames) {
        for (const slice of frame.slices) {
          const invalidBoundingBoxes = slice.componentboundingboxes?.filter(box => box.x_max < box.x_min || box.y_max < box.y_min) || [];
          if (invalidBoundingBoxes.length > 0) {
            const invalidBoundingBoxesResult = invalidBoundingBoxes.map(box => `(${box.x_min}, ${box.y_min}) to (${box.x_max}, ${box.y_max})`).join(", ");
            logger.warn(`${serviceLocation}: Invalid bounding box coordinates for project segmentation mask update: ${invalidBoundingBoxesResult}`);
            return { success: false, operation, message: `Invalid bounding box coordinates for project segmentation mask update: ${invalidBoundingBoxesResult}.` };
          }
          if (slice.segmentationmasks && Array.isArray(slice.segmentationmasks)) {
            for (const maskEntry of slice.segmentationmasks) {
              if (maskEntry.segmentationmaskcontents === null ||
                maskEntry.segmentationmaskcontents === undefined ||
                typeof maskEntry.segmentationmaskcontents !== 'string') {
                const offendingLocation = `frame ${frame.frameindex}, slice ${slice.sliceindex}, class ${maskEntry.class}`; // Define offendingLocation and messageDetail here
                const messageDetail = `segmentationmaskcontents must be a non-null string. Received: ${maskEntry.segmentationmaskcontents}`; // Define messageDetail here
                logger.warn(`${serviceLocation}: Invalid input for project segmentation mask update: ${messageDetail} in ${offendingLocation}.`);
                return {
                  success: false,
                  operation,
                  message: `Invalid input for project segmentation mask update: ${messageDetail} in ${offendingLocation}.`
                };
              }
            }
          }
        }
      }
      mask.frames = maskupdates.frames as mongoose.Types.DocumentArray<IProjectSegmentationMaskDocument['frames'][0]>;
    }

    await mask.save();

    logger.info(`${serviceLocation}: Project segmentation mask ${maskid} updated successfully.`);
    return { success: true, operation, projectsegmentationmask: mask };

  } catch (error: unknown) {
    LogError(error as Error, serviceLocation, `Error updating project segmentation mask, ${error}`);
    return { success: false, operation, message: "Error updating project segmentation mask." };
  }
};

// deleteProjectSegmentationMask function
const deleteProjectSegmentationMask = async (maskid: string): Promise<ProjectSegmentationMaskCrudResult> => {
  const operation = CRUDOperation.DELETE;
  try {
    // Find the segmentation mask by ID
    const mask = await projectSegmentationMaskModel.findById(maskid);
    if (!mask) {
      logger.warn(`${serviceLocation}: Project segmentation mask ${maskid} not found.`);
      return { success: false, operation, message: `Project segmentation mask ${maskid} not found.` };
    }
    // Delete the segmentation mask
    await mask.deleteOne();
    logger.info(`${serviceLocation}: Project segmentation mask ${mask._id} deleted successfully.`);
    return { success: true, operation, message: `Project segmentation mask ${mask._id} deleted successfully.` };
  } catch (error: unknown) {
    LogError(error as Error, serviceLocation, `Error deleting project segmentation mask ${maskid}.`);
    return { success: false, operation, message: "Error deleting project segmentation mask." };
  }
}

/* Project Reconstruction section */

/**
 * Creates a new 3D reconstruction record in the database.
 * Validates the provided data, including checking for the existence of the referenced project ID,
 * required segmentation mask ID, ensuring string inputs are not empty, numeric inputs are valid,
 * and that the segmentation mask belongs to the same project.
 * 
 * @async
 * @function createProjectReconstruction
 * @param {IProjectReconstruction} reconstruction - An object containing the details of the reconstruction to create.
 * @returns {Promise<ProjectReconstructionCrudResult>} A promise resolving to a ProjectReconstructionCrudResult object.
 * - On success: `{ success: true, operation: CREATE, projectreconstruction: IProjectReconstructionDocument }` containing the created reconstruction document.
 * - On failure (project not found): `{ success: false, operation: CREATE, message: "Project ID ... does not exist." }`.
 * - On failure (segmentation mask not found or mismatch): `{ success: false, operation: CREATE, message: "Segmentation mask ... does not exist or does not belong to the same project." }`.
 * - On failure (duplicate name): `{ success: false, operation: CREATE, message: "Reconstruction with name ... already exists for this project." }`.
 * - On failure (invalid input): `{ success: false, operation: CREATE, message: "Invalid input parameters..." }`.
 * - On database error: `{ success: false, operation: CREATE, message: "Error creating project reconstruction." }`.
 */
const createProjectReconstruction = async (
  reconstruction: IProjectReconstruction
): Promise<ProjectReconstructionCrudResult> => {
  const operation = CRUDOperation.CREATE;
  const recon = reconstruction; 
  try {
    // 1. Validate that referenced project exists
    const projectid = reconstruction.projectid;
    const projectidexists = await projectModel.exists({ _id: projectid });
    if (!projectidexists) {
      logger.warn(`${serviceLocation}: Project ID ${projectid} does not exist.`);
      return { success: false, operation, message: `Project ID ${projectid} does not exist.` };
    }

    // 2. Validate that the maskId exists and belongs to the same project (only if maskId is provided)
    if (recon.maskId) {
      const maskExists = await projectSegmentationMaskModel.findOne({ 
        _id: recon.maskId
      });
      
      if (!maskExists) {
        logger.warn(`${serviceLocation}: Segmentation mask ID ${recon.maskId} does not exist.`);
        return { success: false, operation, message: `Segmentation mask ID ${recon.maskId} does not exist.` };
      }
      
      // Ensure the mask's projectId matches the reconstruction's projectId
      if (maskExists.projectid !== recon.projectid) {
        logger.warn(`${serviceLocation}: Segmentation mask ${recon.maskId} does not belong to project ${recon.projectid}. Mask belongs to project ${maskExists.projectid}.`);
        return { success: false, operation, message: `Segmentation mask ${recon.maskId} does not belong to project ${recon.projectid}. Mask belongs to project ${maskExists.projectid}.` };
      }
    }

    // 3. Check for name uniqueness within the project 
    const reconstructionNameExists = await projectReconstructionModel.exists({ 
      name: recon.name, 
      projectid: recon.projectid 
    });
    
    if (reconstructionNameExists) {
      logger.warn(`${serviceLocation}: Invalid input parameters for project reconstruction creation: Reconstruction name ${recon.name} already exists for this project.`);
      return { success: false, operation, message: `Invalid input parameters for project reconstruction creation: Reconstruction name ${recon.name} already exists for this project.` };
    }

    // 5. Validate required string inputs
    const requiredStringInputs = [
      recon.projectid,
      recon.maskId,
      recon.name,
      recon.filename,
      recon.filehash,
      recon.basepath,
      recon.reconstructionfolderpath,
      recon.meshFormat
    ];
    
    const emptyStringInputs = requiredStringInputs.filter(input => !input || typeof input !== 'string' || input.trim() === '');
    if (emptyStringInputs.length > 0) {
      logger.warn(`${serviceLocation}: Invalid input parameters for project reconstruction creation: ${emptyStringInputs.join(", ")}`);
      return { success: false, operation, message: `Invalid input parameters for project reconstruction creation: ${emptyStringInputs.join(", ")}` };
    }

    // 6. Validate required numeric inputs
    const numericInputs = [recon.filesize];
    const invalidNumericInputs = numericInputs.filter(input => typeof input !== 'number' || isNaN(input) || input < 0);
    if (invalidNumericInputs.length > 0) {
      logger.warn(`${serviceLocation}: Invalid numeric input parameters for project reconstruction creation: ${invalidNumericInputs.join(", ")}`);
      return { success: false, operation, message: `Invalid numeric input parameters for project reconstruction creation.` };
    }

    // 7. Validate required boolean inputs 
    if (typeof recon.isSaved !== 'boolean' || typeof recon.isAIGenerated !== 'boolean') {
      logger.warn(`${serviceLocation}: Invalid boolean input parameters for project reconstruction creation: isSaved and isAIGenerated must be boolean values.`);
      return { success: false, operation, message: `Invalid boolean input parameters for project reconstruction creation: isSaved and isAIGenerated must be boolean values.` };
    }

    // 8. Validate enum fields 
    if (!Object.values(MeshFormat).includes(recon.meshFormat)) {
      logger.warn(`${serviceLocation}: Invalid meshFormat: ${recon.meshFormat}. Valid values are: ${Object.values(MeshFormat).join(", ")}`);
      return { success: false, operation, message: `Invalid meshFormat: ${recon.meshFormat}. Valid values are: ${Object.values(MeshFormat).join(", ")}` };
    }

    // 9. Validate reconstructedMesh structure 
    if (!recon.reconstructedMesh || typeof recon.reconstructedMesh !== 'object') {
      logger.warn(`${serviceLocation}: Invalid input parameters for project reconstruction creation: reconstructedMesh is required and must be an object.`);
      return { success: false, operation, message: `Invalid input parameters for project reconstruction creation: reconstructedMesh is required and must be an object.` };
    }

    // Validate required mesh properties
    const requiredMeshStringFields: (keyof typeof recon.reconstructedMesh)[] = ['path', 'filename', 'hash', 'format'];
    for (const field of requiredMeshStringFields) {
      const value = recon.reconstructedMesh[field];
      if (!value || typeof value !== 'string' || (value as string).trim() === '') {
        logger.warn(`${serviceLocation}: Invalid reconstructedMesh.${field}: must be a non-empty string`);
        return { success: false, operation, message: `Invalid reconstructedMesh.${field}: must be a non-empty string` };
      }
    }

    // Validate required mesh filesize
    if (typeof recon.reconstructedMesh.filesize !== 'number' || isNaN(recon.reconstructedMesh.filesize) || recon.reconstructedMesh.filesize < 0) {
      logger.warn(`${serviceLocation}: Invalid reconstructedMesh.filesize: must be a non-negative number`);
      return { success: false, operation, message: `Invalid reconstructedMesh.filesize: must be a non-negative number` };
    }

    // 10. Create and save the new reconstruction 
    const newProjectReconstruction = new projectReconstructionModel(recon);
    const result = await newProjectReconstruction.save();
    
    if (!result) {
      logger.warn(`${serviceLocation}: Error creating project reconstruction.`);
      return { success: false, operation, message: "Error creating project reconstruction." };
    }

    logger.info(`${serviceLocation}: Project reconstruction ${result._id} created successfully for project ${recon.projectid}.`);
    return { success: true, operation, projectreconstruction: result };
  } catch (error: unknown) {
    LogError(error as Error, serviceLocation, `Error creating project reconstruction, ${error}`);
    return { success: false, operation, message: "Error creating project reconstruction." };
  }
};

/**
 * Reads 3D reconstruction(s) from the database based on project ID and optional reconstruction ID or mask ID.
 * Validates input parameters and performs filtered queries based on the provided criteria.
 * This function supports multiple query patterns:
 * - Single reconstruction by ID (when both projectid and reconstructionid are provided)
 * - All reconstructions for a project (when only projectid is provided)
 * - All reconstructions for a specific project and mask combination (when projectid and maskid are provided)
 * 
 * @async
 * @function readProjectReconstruction
 * @param {string} projectid - The project ID to search for reconstructions. Must be a valid MongoDB ObjectId string.
 * @param {string} [reconstructionid] - Optional specific reconstruction ID to find a single reconstruction.
 * @param {string} [maskid] - Optional mask ID to filter reconstructions for a specific mask.
 * @returns {Promise<ProjectReconstructionCrudResult>} A promise resolving to a ProjectReconstructionCrudResult object.
 * - On success (single reconstruction found): `{ success: true, operation: READ, projectreconstruction: IProjectReconstructionDocument }`.
 * - On success (multiple reconstructions found): `{ success: true, operation: READ, projectreconstructions: IProjectReconstructionDocument[] }`.
 * - On success (no reconstructions found): `{ success: true, operation: READ, projectreconstructions: [], message: "No reconstructions found..." }`.
 * - On failure (invalid input): `{ success: false, operation: READ, message: "Invalid input parameters..." }`.
 * - On failure (reconstruction not found): `{ success: false, operation: READ, message: "Reconstruction not found." }`.
 * - On database error: `{ success: false, operation: READ, message: "Error reading project reconstructions." }`.
 */
const readProjectReconstruction = async (
  projectid: string, reconstructionid?: string, maskid?: string
): Promise<ProjectReconstructionCrudResult> => {
  const operation = CRUDOperation.READ;
  try {
    // Validate input parameters 
    if (!projectid || typeof projectid !== 'string' || projectid.trim() === '') {
      logger.warn(`${serviceLocation}: Invalid input parameters for reading project reconstructions: projectid must be a non-empty string.`);
      return { success: false, operation, message: `Invalid input parameters for reading project reconstructions: projectid must be a non-empty string.` };
    }

    if (reconstructionid !== undefined && (typeof reconstructionid !== 'string' || reconstructionid.trim() === '')) {
      logger.warn(`${serviceLocation}: Invalid input parameters for reading project reconstructions: reconstructionid must be a non-empty string if provided.`);
      return { success: false, operation, message: `Invalid input parameters for reading project reconstructions: reconstructionid must be a non-empty string if provided.` };
    }
    
    if (reconstructionid) {
      // Find specific reconstruction 
      const reconstruction = await projectReconstructionModel.findOne({ 
        _id: reconstructionid, 
        projectid: projectid 
      });
      
      if (!reconstruction) {
        logger.warn(`${serviceLocation}: Reconstruction ${reconstructionid} not found for project ${projectid}.`);
        return { success: false, operation, message: `Reconstruction ${reconstructionid} not found for project ${projectid}.` };
      }
      
      logger.info(`${serviceLocation}: Reconstruction ${reconstructionid} found for project ${projectid}.`);
      return { success: true, operation, projectreconstruction: reconstruction };
    } else {
      // Build query based on provided parameters
      const query: any = { projectid };
      if (maskid) {
        query.maskId = maskid;
      }
      
      // Find reconstructions based on query
      const reconstructions = await projectReconstructionModel.find(query);
      
      if (reconstructions.length === 0) {
        const searchDesc = maskid ? `project ${projectid} and mask ${maskid}` : `project ${projectid}`;
        logger.info(`${serviceLocation}: No reconstructions found for ${searchDesc}.`);
        return { success: true, operation, projectreconstructions: [], message: `No reconstructions found for ${searchDesc}.` };
      }
      
      const searchDesc = maskid ? `project ${projectid} and mask ${maskid}` : `project ${projectid}`;
      logger.info(`${serviceLocation}: Found ${reconstructions.length} reconstruction(s) for ${searchDesc}.`);
      return { success: true, operation, projectreconstructions: reconstructions };
    }
  } catch (error: unknown) {
    LogError(error as Error, serviceLocation, `Error reading project reconstructions for project ${projectid}, ${error}`);
    return { success: false, operation, message: "Error reading project reconstructions." };
  }
};

/**
 * Updates an existing project reconstruction in the database.
 * Validates the existence of the reconstruction ID before applying updates.
 * Checks for uniqueness of the name and validates basic field types.
 * Follows the same pattern as updateProjectSegmentationMask for consistency.
 * 
 * @async
 * @function updateProjectReconstruction
 * @param {string} reconstructionid - The ID of the reconstruction to update.
 * @param {Partial<IProjectReconstructionDocument>} updates - An object containing the updates to apply to the reconstruction.
 * @returns {Promise<ProjectReconstructionCrudResult>} A promise resolving to a ProjectReconstructionCrudResult object.
 * - On success: `{ success: true, operation: CRUDOperation.UPDATE, projectreconstruction: IProjectReconstructionDocument }` containing the updated reconstruction document.
 * - On failure (reconstruction not found): `{ success: false, operation: CRUDOperation.UPDATE, message: "Reconstruction ID ... does not exist." }`.
 * - On failure (name conflict): `{ success: false, operation: CRUDOperation.UPDATE, message: "Reconstruction name ... already exists for this project." }`.
 * - On database error: `{ success: false, operation: CRUDOperation.UPDATE, message: "Error updating project reconstruction." }`.
 */
const updateProjectReconstruction = async (
  reconstructionid: string,
  updates: Partial<IProjectReconstructionDocument>
): Promise<ProjectReconstructionCrudResult> => {
  const operation = CRUDOperation.UPDATE;
  try {
    const reconstruction = await projectReconstructionModel.findById(reconstructionid);
    if (!reconstruction) {
      logger.warn(`${serviceLocation}: Project reconstruction ${reconstructionid} not found.`);
      return { success: false, operation, message: `Project reconstruction ${reconstructionid} not found.` };
    }

    if (updates.name && updates.name !== reconstruction.name) {
      const nameExists = await projectReconstructionModel.exists({
        projectid: reconstruction.projectid,
        name: updates.name,
        _id: { $ne: reconstructionid }
      });
      if (nameExists) {
        return { success: false, operation, message: `Reconstruction name '${updates.name}' already exists for this project.` };
      }
      reconstruction.name = updates.name;
    }

    if (updates.description !== undefined) {
      reconstruction.description = updates.description;
    }

    if (updates.isSaved !== undefined) {
      reconstruction.isSaved = updates.isSaved;
    }

    if (updates.isAIGenerated !== undefined) {
      reconstruction.isAIGenerated = updates.isAIGenerated;
    }

    if (updates.filesize !== undefined) {
      reconstruction.filesize = updates.filesize;
    }

    if (updates.meshFormat !== undefined) {
      reconstruction.meshFormat = updates.meshFormat;
    }

    if (updates.reconstructedMesh) {
      reconstruction.reconstructedMesh = updates.reconstructedMesh;
    }

    await reconstruction.save();

    logger.info(`${serviceLocation}: Project reconstruction ${reconstructionid} updated successfully.`);
    return { success: true, operation, projectreconstruction: reconstruction };

  } catch (error: unknown) {
    LogError(error as Error, serviceLocation, `Error updating project reconstruction, ${error}`);
    return { success: false, operation, message: "Error updating project reconstruction." };
  }
};

/**
 * Deletes a 3D reconstruction record from the database.
 * Validates input parameters, checks for existence, and performs deletion with verification.
 * Follows the same pattern as deleteUser and deleteProject functions for consistency.
 * Note: This only deletes the database record. S3 files must be cleaned up separately by the API layer.
 * 
 * @async
 * @function deleteProjectReconstruction
 * @param {string} reconstructionid - The ID of the reconstruction to delete. Must be a valid MongoDB ObjectId string.
 * @returns {Promise<ProjectReconstructionCrudResult>} A promise resolving to a ProjectReconstructionCrudResult object.
 * - On success: `{ success: true, operation: DELETE, message: "Reconstruction ... deleted successfully." }`.
 * - On failure (reconstruction not found): `{ success: false, operation: DELETE, message: "Reconstruction ... not found." }`.
 * - On failure (invalid input): `{ success: false, operation: DELETE, message: "Invalid input parameters..." }`.
 * - On database error: `{ success: false, operation: DELETE, message: "Error deleting project reconstruction." }`.
 */
const deleteProjectReconstruction = async (reconstructionid: string): Promise<ProjectReconstructionCrudResult> => {
  const operation = CRUDOperation.DELETE;
  try {
    // Validate input parameters 
    if (!reconstructionid || typeof reconstructionid !== 'string' || reconstructionid.trim() === '') {
      logger.warn(`${serviceLocation}: Invalid input parameters for deleting project reconstruction: reconstructionid must be a non-empty string.`);
      return { success: false, operation, message: `Invalid input parameters for deleting project reconstruction: reconstructionid must be a non-empty string.` };
    }

    // Check if the reconstruction exists
    const existingReconstruction = await projectReconstructionModel.findById(reconstructionid);
    if (!existingReconstruction) {
      logger.warn(`${serviceLocation}: Reconstruction ${reconstructionid} not found.`);
      return { success: false, operation, message: `Reconstruction ${reconstructionid} not found.` };
    }

    // Store reconstruction info for logging before deletion
    const reconstructionInfo = {
      name: existingReconstruction.name,
      projectid: existingReconstruction.projectid,
      isAIGenerated: existingReconstruction.isAIGenerated
    };

    // Delete the reconstruction
    await existingReconstruction.deleteOne();

    // Verify deletion was successful by attempting to find the reconstruction again
    const verifyDeletion = await projectReconstructionModel.findById(reconstructionid);
    if (verifyDeletion) {
      logger.warn(`${serviceLocation}: Reconstruction ${reconstructionid} was not deleted successfully.`);
      return { success: false, operation, message: `Reconstruction ${reconstructionid} was not deleted successfully.` };
    }
    
    // Reconstruction deleted successfully
    logger.info(`${serviceLocation}: Reconstruction ${reconstructionid} (${reconstructionInfo.name}) deleted successfully from project ${reconstructionInfo.projectid}. AI Generated: ${reconstructionInfo.isAIGenerated}`);
    return { success: true, operation, message: `Reconstruction ${reconstructionid} deleted successfully.` };

  } catch (error: unknown) {
    LogError(error as Error, serviceLocation, `Error deleting project reconstruction ${reconstructionid}, ${error}`);
    return { success: false, operation, message: "Error deleting project reconstruction." };
  }
};

// Job Queue section
// Create Job schema
const jobSchema = new mongoose.Schema({
  userid: { type: String, required: true },
  projectid: { type: String, required: true },
  uuid: { type: String, required: true, unique: true }, // Unique identifier for the job
  status: { type: String, required: true, enum: Object.values(JobStatus) },
  result: {
    type: mongoose.Schema.Types.Mixed, // Changed to Mixed type
    required: false
  },
  message: { type: String, required: false }, // Message related to the job
  segmentationName: { type: String, required: false }, // Optional user-defined name
  segmentationDescription: { type: String, required: false }, // Optional user-defined description
  segmentationSouce: { type: String, required: false, enum: Object.values(segmentationSource) }, // Optional source of the segmentation
  segmentationModel: { type: String, required: false, enum: Object.values(SegmentationModel) }, // Optional model used for segmentation
}, { timestamps: true });
const jobModel = mongoose.model<IJobDocument>('Job', jobSchema);

// Job CRUD functions
const createJob = async (job: IJob): Promise<JobCrudResult> => {
  const operation = CRUDOperation.CREATE;
  try {
    const newJob = new jobModel(job);
    const results = await newJob.save();
    if (results._id) {
      logger.info(`${serviceLocation}: Job ${results._id} created successfully.`);
      return { success: true, operation, job: newJob };
    }
    else {
      throw new Error(`Job ${results._id} was not created successfully.`);
    }
  } catch (error: unknown) {
    LogError(error as Error, serviceLocation, `Error creating job.`);
    return { success: false, operation, message: "Error creating job." };
  }
}

// readJob function (only single job)
const readJob = async (uuid: string): Promise<JobCrudResult> => {
  const operation = CRUDOperation.READ;
  try {
    const job = await jobModel.findOne({ uuid: uuid });
    if (!job) {
      logger.warn(`${serviceLocation}: Job for user ${uuid} not found.`);
      return { success: false, operation, message: `Job for user ${uuid} not found.` };
    }
    logger.info(`${serviceLocation}: Job ${job._id} found matching UUID if ${uuid}.`);
    return { success: true, operation, job: job };
  } catch (error: unknown) {
    LogError(error as Error, serviceLocation, `Error reading job.`);
    return { success: false, operation, message: "Error reading job." };
  }
}

// updateJob function
const updateJob = async (uuid: string, updates: Partial<IJob>): Promise<JobCrudResult> => {
  const operation = CRUDOperation.UPDATE;
  try {
    const job = await jobModel.findOne({ uuid: uuid });
    if (!job) {
      logger.warn(`${serviceLocation}: Job for user ${uuid} not found.`);
      return { success: false, operation, message: `Job for user ${uuid} not found.` };
    }
    // Update the job with the provided updates
    Object.assign(job, updates);
    await job.save();
    logger.info(`${serviceLocation}: Job ${job._id} updated successfully.`);
    return { success: true, operation, job: job };
  } catch (error: unknown) {
    LogError(error as Error, serviceLocation, `Error updating job.`);
    return { success: false, operation, message: "Error updating job." };
  }
}

// deleteJob function
const deleteJob = async (uuid: string): Promise<JobCrudResult> => {
  const operation = CRUDOperation.DELETE;
  try {
    const job = await jobModel.findOne({ uuid: uuid });
    if (!job) {
      logger.warn(`${serviceLocation}: Job for user ${uuid} not found.`);
      return { success: false, operation, message: `Job for user ${uuid} not found.` };
    }
    await job.deleteOne();
    logger.info(`${serviceLocation}: Job ${job._id} deleted successfully.`);
    return { success: true, operation, message: `Job ${job._id} deleted successfully.` };
  } catch (error: unknown) {
    LogError(error as Error, serviceLocation, `Error deleting job.`);
    return { success: false, operation, message: "Error deleting job." };
  }
}

// Administrative Tools section
// GPU section 
/**
 * The GPU should only have one entry
 */
const gpuHostSchema = new mongoose.Schema({
  host: { type: String, required: true, unique: true },
  port: { type: Number, required: true },
  isHTTPS: { type: Boolean, required: true, default: false }, // Defaults to HTTP
  gpuServerAuthJwtSecret: { type: String, required: true, default: "change-this" }, // JWT secret for GPU server authentication
  serverIdForGpuServer: { type: String, required: true, default: "default-server-id" }, // Server ID for GPU server
  gpuServerIdentity: { type: String, required: true, default: "default-gpu-server-identity" }, // Identity of the GPU server
  jwtRefreshInterval: { type: Number, required: true, default: 8 * 60 * 1000 }, // JWT refresh interval in seconds
  jwtLifetimeSeconds: { type: Number, required: true, default: 10 * 60 }, // JWT lifetime in seconds
  description: { type: String, required: false, default: "No description added." },
  setBy: { type: String, required: true }, // The id of the admin who changed the GPU host
}, { timestamps: true });
// Singleton enforcement method - Only allow a single entry when a save (create new) is attempted
// Only triggers if this.isNew is true, meaning it's a new document being created
gpuHostSchema.pre('save', async function (next) {
  if (this.isNew) {
    const existingCount = await mongoose.model<IGPUHostDocument>('GPUHost').countDocuments({});
    if (existingCount > 0) {
      throw new Error('Only one GPU host configuration is allowed. Update the existing one instead.');
    }
  }
  next();
});
const gpuHostModel = mongoose.model<IGPUHostDocument>('GPUHost', gpuHostSchema);

// Seeding the GPU host configuration
// Should only have one GPU host entry in the database
/**
 * Seeds a new GPU host configuration entry into the database based on environment variables.
 * If entry already exists, nothing happens.
 * This overrides the previous implementation which was using hardcoded environment variables.
 * @async
 * @function seedGPUHost
 * @returns {Promise<void>} A promise that resolves when the GPU host configuration is seeded successfully or if it already exists.
 * @throws {Error} If the admin user is not found or if there is an error during the seeding process.
 */
const seedGPUHost = async (): Promise<void> => {
  try {
    const existingGPUHost = await gpuHostModel.findOne({});
    if (existingGPUHost) {
      logger.info(`${serviceLocation}: GPU host configuration already exists. No need to create a new one.`);
      return; // GPU host already exists, no need to create a new one
    }
    // Get admin ID from User Model
    const adminUser = await userModel.findOne({ role: UserRole.Admin, username: 'admin' });
    if (!adminUser) {
      logger.error(`${serviceLocation}: Admin user not found. Cannot create GPU host configuration.`);
      throw new Error('Admin user not found. Cannot create GPU host configuration.');
    }
    // Create a new GPU host configuration with default values
    const newGpuHostConfig: IGPUHost = {
      host: process.env.GPU_SERVER_URL || 'localhost',
      port: parseInt(process.env.GPU_SERVER_PORT || '8001', 10),
      isHTTPS: process.env.GPU_SERVER_SSL === 'true',
      gpuServerAuthJwtSecret: process.env.GPU_SERVER_AUTH_JWT_SECRET || 'change-this',
      serverIdForGpuServer: process.env.GPU_SERVER_ID_FOR_GPU_SERVER || 'default-server-id',
      gpuServerIdentity: process.env.GPU_SERVER_IDENTITY || 'default-gpu-server-identity',
      jwtRefreshInterval: parseInt(process.env.GPU_SERVER_JWT_REFRESH_INTERVAL || '480000', 10), // Default to 8 minutes
      jwtLifetimeSeconds: parseInt(process.env.GPU_SERVER_JWT_LIFETIME_SECONDS || '600', 10), // Default to 10 minutes
      description: 'Default GPU host configuration - change environment variables if required.',
      setBy: String(adminUser._id) // This should be the ID of the admin who created the GPU host
    };
    const newGPUHost = new gpuHostModel(newGpuHostConfig);
    await newGPUHost.save();
    logger.info(`${serviceLocation}: GPU host configuration created successfully.`);
  }
  catch (error: unknown) {
    LogError(error as Error, serviceLocation, `Error creating GPU host configuration.`);
  }
}

// createGPUHost and deleteGPUHost is omitted as GPU host should only have one entry in the database.

// Helper function to validate the hostname format (can be IP addresses or domain or localhost)
const isValidIpOrDomain = (ip: string): boolean => {
  if (typeof ip !== 'string' || ip === '') {
    return false;
  }

  // Special Case
  if (ip === "localhost") return true;

  // RegEx for IPv4 and IPv6
  const ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
  if (ipv4Regex.test(ip)) return true;
  const ipv6Regex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))$/i;
  if (ipv6Regex.test(ip)) return true;

  // RegEx for Domain Name
  const domainNameRegex = /^((?!-)[A-Za-z0-9-]{1,63}(?<!-)\.)+[A-Za-z]{2,6}$/;
  if (domainNameRegex.test(ip)) return true;

  return false;
}

// GPU Host CRUD Function
// readGPUHost - only fetches the one and only entry in the database
/**
 * Reads the GPU host configuration from the database.
 * 
 * Attempts to find the single GPU host configuration document in the database.
 * If no configuration is found, logs a warning and returns a failure result.
 * If successful, logs the operation and returns the GPU host configuration.
 * 
 * @returns A Promise that resolves to a GPUHostCrudResult object containing:
 *   - success: boolean indicating if the operation was successful
 *   - operation: CRUDOperation.READ enum value
 *   - gpuHost: the GPU host configuration object (if successful)
 *   - message: error or warning message (if unsuccessful)
 * 
 * @throws Catches and logs any database errors, returning a failure result with error message
 */
const readGPUHost = async (): Promise<GPUHostCrudResult> => {
  try {
    const gpuHost = await gpuHostModel.findOne({});
    if (!gpuHost) {
      logger.warn(`${serviceLocation}: No GPU host configuration found.`);
      return { success: false, operation: CRUDOperation.READ, message: "No GPU host configuration found." };
    }
    logger.info(`${serviceLocation}: GPU host configuration read successfully.`);
    return { success: true, operation: CRUDOperation.READ, gpuHost: gpuHost }; // Return the GPU host configuration

  }
  catch (error: unknown) {
    LogError(error as Error, serviceLocation, `Error reading GPU host configuration.`);
    return { success: false, operation: CRUDOperation.READ, message: "Unknown error while reading GPU host configuration." };
  }
}

/**
 * Updates the GPU host configuration with the provided partial updates.
 * 
 * @param updates - Partial GPU host configuration object containing the fields to update
 * @returns Promise that resolves to a GPUHostCrudResult indicating success/failure and updated data
 * 
 * @remarks
 * This function performs validation on the following fields:
 * - `host`: Must be a valid IP address or domain name
 * - `port`: Must be a number between 1 and 65535
 * - `jwtRefreshInterval`: Must be a number of at least 60000 milliseconds (60 seconds)
 * - `jwtLifetimeSeconds`: Must be a number of at least 60 seconds
 * 
 * The function will only update fields that are provided in the updates object.
 * If no GPU host configuration exists in the database, the operation will fail (which should not happen).
 * 
 * @example
 * ```typescript
 * const result = await updateGPUHost({
 *   host: "192.168.1.100",
 *   port: 8080,
 *   isHTTPS: true
 * });
 * if (result.success) {
 *   console.log("GPU host updated successfully");
 * }
 * ```
 */
const updateGPUHost = async (updates: Partial<IGPUHost>): Promise<GPUHostCrudResult> => {
  try {
    const gpuHost = await gpuHostModel.findOne({});
    if (!gpuHost) {
      logger.warn(`${serviceLocation}: No GPU host configuration found.`);
      return { success: false, operation: CRUDOperation.UPDATE, message: "No GPU host configuration found." };
    }
    // Validation
    if (updates.host && !isValidIpOrDomain(updates.host.trim())) {
      return { success: false, operation: CRUDOperation.UPDATE, message: "Invalid host format" };
    }

    if (updates.port && (typeof updates.port !== 'number' || updates.port < 1 || updates.port > 65535)) {
      return { success: false, operation: CRUDOperation.UPDATE, message: "Port must be between 1 and 65535" };
    }

    if (updates.jwtRefreshInterval && (typeof updates.jwtRefreshInterval !== 'number' || updates.jwtRefreshInterval < 60000)) {
      return { success: false, operation: CRUDOperation.UPDATE, message: "JWT refresh interval must be at least 60 seconds" };
    }

    if (updates.jwtLifetimeSeconds && (typeof updates.jwtLifetimeSeconds !== 'number' || updates.jwtLifetimeSeconds < 60)) {
      return { success: false, operation: CRUDOperation.UPDATE, message: "JWT lifetime must be at least 60 seconds" };
    }
    // Update the GPU host configuration with the provided updates
    if (updates.host) gpuHost.host = updates.host.trim();
    if (updates.port) gpuHost.port = updates.port;
    if (updates.isHTTPS !== undefined) gpuHost.isHTTPS = updates.isHTTPS; // Update HTTPS status
    if (updates.gpuServerAuthJwtSecret) gpuHost.gpuServerAuthJwtSecret = updates.gpuServerAuthJwtSecret; // Update JWT secret
    if (updates.serverIdForGpuServer) gpuHost.serverIdForGpuServer = updates.serverIdForGpuServer; // Update server ID
    if (updates.gpuServerIdentity) gpuHost.gpuServerIdentity = updates.gpuServerIdentity; // Update GPU server identity
    if (updates.jwtRefreshInterval) gpuHost.jwtRefreshInterval = updates.jwtRefreshInterval; // Update JWT refresh interval
    if (updates.jwtLifetimeSeconds) gpuHost.jwtLifetimeSeconds = updates.jwtLifetimeSeconds; // Update JWT lifetime
    if (updates.description) gpuHost.description = updates.description; // Update description
    if (updates.setBy) gpuHost.setBy = updates.setBy; // Update setBy field

    await gpuHost.save();
    logger.info(`${serviceLocation}: GPU host configuration updated successfully.`);
    return { success: true, operation: CRUDOperation.UPDATE, gpuHost: gpuHost }; // Return the updated GPU host configuration
  }
  catch (error: unknown) {
    LogError(error as Error, serviceLocation, `Error updating GPU host configuration.`);
    return { success: false, operation: CRUDOperation.UPDATE, message: `Unknown error while updating GPU host configuration - ${error}` };
  }
}

// Using ES modules instead of CommonJS which is module.exports = {connectToDatabase, User};
// ONLY unit tests should use userModel, fileModel directly, otherwise use the created functions to create users/files.
export {
  connectToDatabase, userModel, createUser, readUser, updateUser, deleteUser, authenticateUser, UserRole, IUser, IUserSafe, UserCrudResult, CRUDOperation, IUserDocument, IProject, IProjectDocument, IProjectSegmentationMask, projectModel, projectSegmentationMaskModel, createProject, readProject, updateProject, deleteProject, createProjectSegmentationMask, readProjectSegmentationMask, updateProjectSegmentationMask, deleteProjectSegmentationMask, 
  // Project Reconstruction exports
  IProjectReconstruction, IProjectReconstructionDocument, ProjectReconstructionCrudResult, MeshFormat, projectReconstructionModel, createProjectReconstruction, readProjectReconstruction, updateProjectReconstruction, deleteProjectReconstruction,
  // Job and GPU Host exports
  jobModel, createJob, readJob, updateJob, deleteJob, JobStatus, IJob, IJobDocument, IProjectSegmentationMaskDocument, ProjectSegmentationMaskCrudResult, ProjectCrudResult,
  readGPUHost, updateGPUHost, seedGPUHost, gpuHostModel, GPUHostCrudResult, IGPUHost, IGPUHostDocument
};
