// // File: __tests__/database.test.ts
// // Description: This file contains unit tests for the database service functions.
// import { MongoMemoryServer } from 'mongodb-memory-server';
// import mongoose from 'mongoose';
// import {
//   connectToDatabase,
//   userModel,
//   createUser,
//   readUser,
//   updateUser,
//   deleteUser,
//   authenticateUser,
//   UserRole,
//   IUserSafe,
//   UserCrudResult,
//   CRUDOperation
// } from '../src/services/database';
// import bcrypt from 'bcrypt';

// // Mocking logger to prevent console output during tests
// jest.mock('../src/services/logger', () => ({
//   info: jest.fn(),
//   warn: jest.fn(),
//   error: jest.fn()
// }));

// let mongoServer: MongoMemoryServer;
// let dbUri: string;

// // Setup in-memory MongoDB server
// beforeAll(async () => {
//   if (mongoose.connection.readyState !== 1) {
//     mongoServer = await MongoMemoryServer.create();
//     dbUri = mongoServer.getUri();
//     await mongoose.connect(dbUri);
//   }
// });

// // Clean up after tests
// afterAll(async () => {
//   await mongoose.disconnect();
//   if (mongoServer) {
//     await mongoServer.stop();
//   }
// });

// // Clear data between tests for all describe blocks
// beforeEach(async () => {
//   // Clear all collections more reliably
//   const collections = mongoose.connection.collections;
//   for (const key in collections) {
//     await collections[key].deleteMany({});
//   }
// });

// // --- Main Test Suite ---
// describe('Database Service', () => {
//   // --- connectToDatabase Tests ---
//   describe('connectToDatabase', () => {
//     // Basic connection check (relies on beforeAll)
//     it('should establish a connection to the database', () => {
//       expect(mongoose.connection.readyState).toBe(1); // 1 = connected
//     });

//     it("should create a default admin user if none exists", async () => {
//       // Ensure no admins exist initially (beforeEach clears)
//       const beforeCheck = await userModel.findOne({ role: UserRole.Admin });
//       expect(beforeCheck).toBeNull();

//       // Run the function containing createAdminUser logic
//       // In a real scenario, connectToDatabase would connect first, but here we are already connected
//       await connectToDatabase(); // This effectively runs createAdminUser

//       const adminUser = await userModel.findOne({ role: UserRole.Admin });
//       expect(adminUser).not.toBeNull();
//       expect(adminUser?.username).toBe("admin");
//       expect(adminUser?._id).toBeDefined(); // Check _id exists in DB
//     });


//     it("should not create a default admin user if one already exists", async () => {
//       // Arrange: Manually create an admin first
//       const existingAdminData = { username: 'manualAdmin', password: 'pw', email: 'man@admin.com', phone: '111', role: UserRole.Admin };
//       await createUser(existingAdminData.username, existingAdminData.password, existingAdminData.email, existingAdminData.phone, existingAdminData.role);

//       const firstAdmin = await userModel.findOne({ username: existingAdminData.username });
//       expect(firstAdmin).not.toBeNull();
//       const firstAdminId = firstAdmin?._id;

//       // Act: Run connectToDatabase again, which triggers createAdminUser check
//       await connectToDatabase();

//       // Assert: Check only the manually created admin exists
//       const allAdmins = await userModel.find({ role: UserRole.Admin });
//       expect(allAdmins.length).toBe(1); // Only one admin should exist
//       expect(allAdmins[0].username).toBe(existingAdminData.username); // It's the one we created
//       expect(String(allAdmins[0]._id)).toBe(String(firstAdminId)); // Ensure it's the *same* admin
//     });
//   });

//   // --- createUser Tests ---
//   describe('createUser', () => {
//     it('should create a new user successfully with default role', async () => {
//       // Arrange
//       const username = 'testuser';
//       const password = 'password123';
//       const email = 'test@example.com';
//       const phone = '1234567890';

//       // Act
//       const result = await createUser(username, password, email, phone);

//       // Assert - Check result object
//       expect(result.success).toBe(true);
//       if (result.success === true && result.user) { // Type narrowing
//         expect(result.operation).toBe(CRUDOperation.CREATE);
//         expect(result.user).toBeDefined();
//         expect(result.user._id).toBeDefined();
//         expect(typeof result.user._id).toBe('string');
//         expect(result.user._id.length).toBeGreaterThan(0);
//         expect(result.user.username).toBe(username);
//         expect(result.user.email).toBe(email);
//         expect(result.user.phone).toBe(phone);
//         expect(result.user.role).toBe(UserRole.User); // Check default role
//       } else {
//         fail('createUser should have succeeded but failed');
//       }

//       // Assert - Check database state
//       const savedUser = await userModel.findOne({ username: username });
//       expect(savedUser).not.toBeNull();
//       // Check _id consistency with userModel and IUserSafe in UserCrudResult
//       if (result.success && result.user) expect(String(savedUser?._id)).toBe(result.user._id);
//       expect(savedUser?.email).toBe(email);
//       expect(savedUser?.phone).toBe(phone);
//       expect(savedUser?.role).toBe(UserRole.User); // Check default role
//       // Assert - Check password hashing
//       const passwordMatches = await bcrypt.compare(password, savedUser!.password);
//       expect(passwordMatches).toBe(true);
//     });

//     it('should create a new user successfully with a specified role', async () => {
//       // Arrange
//       const username = 'adminuser';
//       const password = 'password123';
//       const email = 'admin@example.com';
//       const phone = '1112223333';
//       const role = UserRole.Admin; // Assuming UserRole is an enum or similar type
//       // Act
//       const result = await createUser(username, password, email, phone, role);
//       // Assert
//       expect(result.success).toBe(true);
//       expect(result.operation).toBe(CRUDOperation.CREATE);
//       if (result.success === true && result.user) expect(result.user.role).toBe(role);
//       else fail('createUser should have succeeded but failed');
//       const savedUser = await userModel.findOne({ username: username });
//       expect(savedUser?.role).toBe(role);
//     });

//     // --- createUser Failure Scenarios ---
//     describe('when unique fields conflict', () => {
//       const conflictUsername = 'conflictUser';
//       const conflictEmail = 'conflict@example.com';
//       const conflictPhone = '5555555555';

//       // Setup the user that will cause conflicts
//       beforeEach(async () => {
//         await createUser(
//           conflictUsername,
//           'password123',
//           conflictEmail,
//           conflictPhone
//         );
//       });

//       it('should fail if username already exists', async () => {
//         const result = await createUser(
//           conflictUsername, // Existing username
//           'newpass',
//           'new@example.com',
//           '1234567890'
//         );
//         expect(result.success).toBe(false);
//         if (result.success === false) {
//           expect(result.message).toContain(`Username "${conflictUsername}" already exists`);
//           expect(result.message).not.toContain('Email'); // Ensure only username conflict is reported
//           expect(result.message).not.toContain('Phone');
//         } else {
//           fail('createUser should have failed (duplicate username) but succeeded');
//         }
//         // Verify no new user was added
//         const users = await userModel.find({ email: 'new@example.com' });
//         expect(users.length).toBe(0);
//       });

//       it('should fail if email already exists', async () => {
//         const result = await createUser(
//           'newUser',
//           'newpass',
//           conflictEmail, // Existing email
//           '1234567890'
//         );
//         expect(result.success).toBe(false);
//         if (result.success === false) {
//           expect(result.message).toContain(`Email "${conflictEmail}" already exists`);
//           expect(result.message).not.toContain('Username');
//           expect(result.message).not.toContain('Phone');
//         } else {
//           fail('createUser should have failed (duplicate email) but succeeded');
//         }
//       });

//       it('should fail if phone already exists', async () => {
//         const result = await createUser(
//           'newUser',
//           'newpass',
//           'new@example.com',
//           conflictPhone // Existing phone
//         );
//         expect(result.success).toBe(false);
//         if (result.success === false) {
//           expect(result.message).toContain(`Phone "${conflictPhone}" already exists`);
//           expect(result.message).not.toContain('Username');
//           expect(result.message).not.toContain('Email');
//         } else {
//           fail('createUser should have failed (duplicate phone) but succeeded');
//         }
//       });

//       it('should fail and report all conflicts if username, email, and phone already exist', async () => {
//         const result = await createUser(
//           conflictUsername, // Existing username
//           'newpass',
//           conflictEmail, // Existing email
//           conflictPhone // Existing phone
//         );
//         expect(result.success).toBe(false);
//         if (result.success === false) {
//           expect(result.message).toContain(`Username "${conflictUsername}" already exists`);
//           expect(result.message).toContain(`Email "${conflictEmail}" already exists`);
//           expect(result.message).toContain(`Phone "${conflictPhone}" already exists`);
//         } else {
//           fail('createUser should have failed (all duplicates) but succeeded');
//         }
//       });
//     });
//   });

//   // --- readUser Tests ---
//   describe('readUser', () => {
//     // Sample users for testing read operations
//     const user1Data = { username: 'reader1', email: 'reader1@example.com', phone: '1010101010', password: 'password1', role: UserRole.User };
//     const user2Data = { username: 'reader2', email: 'reader2@example.com', phone: '2020202020', password: 'password2', role: UserRole.User };
//     const adminUserData = { username: 'readerAdmin', email: 'readerAdmin@example.com', phone: '3030303030', password: 'passwordAdmin', role: UserRole.Admin };

//     // Store created user IDs for ID-based tests
//     let user1Id: string;
//     let user2Id: string;
//     let adminUserId: string;

//     // Setup users before each test in this block
//     beforeEach(async () => {
//       // Create the sample users needed for read tests
//       const res1 = await createUser(user1Data.username, user1Data.password, user1Data.email, user1Data.phone, user1Data.role);
//       const res2 = await createUser(user2Data.username, user2Data.password, user2Data.email, user2Data.phone, user2Data.role);
//       const resAdmin = await createUser(adminUserData.username, adminUserData.password, adminUserData.email, adminUserData.phone, adminUserData.role);

//       // Store IDs if creation was successful
//       if (res1.success && res1.user) user1Id = res1.user._id;
//       if (res2.success && res2.user) user2Id = res2.user._id;
//       if (resAdmin.success && resAdmin.user) adminUserId = resAdmin.user._id;

//       // Fail fast if setup didn't work
//       if (!user1Id || !user2Id || !adminUserId) {
//         throw new Error("Failed to create users during readUser beforeEach setup.");
//       }
//     });

//     it('should return all users when no criteria are provided', async () => {
//       // Act
//       const result = await readUser(); // No arguments

//       // Assert
//       expect(result.success).toBe(true);
//       expect(result.operation).toBe(CRUDOperation.READ);
//       expect(result.users).toBeDefined();
//       expect(result.user).toBeUndefined(); // Should not return single user
//       if (result.success && result.users) { // Type guard
//         expect(result.users.length).toBe(3); // user1, user2, adminUser
//         const usernames = result.users.map(u => u.username);
//         expect(usernames).toContain(user1Data.username);
//         expect(usernames).toContain(user2Data.username);
//         expect(usernames).toContain(adminUserData.username);
//       } else {
//         fail('readUser() without criteria failed or did not return users.');
//       }
//     });

//     // --- NEW: Test searching by ID ---
//     it('should find a single user by unique ID and return it in the user field', async () => {
//       // Act
//       const result = await readUser(user1Id); // Pass ID as the first argument

//       // Assert
//       expect(result.success).toBe(true);
//       expect(result.operation).toBe(CRUDOperation.READ);
//       expect(result.user).toBeDefined(); // Expect single user object
//       expect(result.users).toBeUndefined(); // Expect users array to be undefined

//       if (result.success && result.user) {
//         expect(result.user._id).toBe(user1Id);
//         expect(result.user.username).toBe(user1Data.username);
//         expect(result.user.email).toBe(user1Data.email);
//         expect(result.user.phone).toBe(user1Data.phone);
//         expect(result.user.role).toBe(user1Data.role);
//         // IMPORTANT: Verify password is NOT present
//         expect((result.user as any).password).toBeUndefined();
//       } else {
//         fail('readUser(id) failed or did not return a single user.');
//       }
//     });

//     it('should find a user by unique username', async () => {
//       // Act
//       const result = await readUser(undefined, user1Data.username); // id is undefined

//       // Assert
//       expect(result.success).toBe(true);
//       expect(result.operation).toBe(CRUDOperation.READ);
//       expect(result.users).toBeDefined(); // Expect users array
//       expect(result.user).toBeUndefined(); // Expect single user to be undefined
//       if (result.success && result.users) {
//         expect(result.users.length).toBe(1);
//         expect(result.users[0]._id).toBe(user1Id);
//         expect(result.users[0].username).toBe(user1Data.username);
//         expect(result.users[0].email).toBe(user1Data.email);
//         // IMPORTANT: Verify password is NOT present
//         expect((result.users[0] as any).password).toBeUndefined();
//       } else {
//         fail('readUser(username) failed or did not return users.');
//       }
//     });

//     it('should find a user by unique email', async () => {
//       // Act
//       const result = await readUser(undefined, undefined, user2Data.email); // id, username are undefined

//       // Assert
//       expect(result.success).toBe(true);
//       expect(result.users).toBeDefined();
//       expect(result.user).toBeUndefined();
//       expect(result.users?.length).toBe(1);
//       expect(result.users?.[0]._id).toBe(user2Id);
//       expect(result.users?.[0].username).toBe(user2Data.username);
//       expect(result.users?.[0].email).toBe(user2Data.email);
//     });

//     it('should find a user by unique phone', async () => {
//       // Act
//       const result = await readUser(undefined, undefined, undefined, adminUserData.phone); // id, username, email are undefined

//       // Assert
//       expect(result.success).toBe(true);
//       expect(result.users).toBeDefined();
//       expect(result.user).toBeUndefined();
//       expect(result.users?.length).toBe(1);
//       expect(result.users?.[0]._id).toBe(adminUserId);
//       expect(result.users?.[0].username).toBe(adminUserData.username);
//       expect(result.users?.[0].phone).toBe(adminUserData.phone);
//     });

//     it('should return multiple users when searching by role (UserRole.User)', async () => {
//       // Act
//       const result = await readUser(undefined, undefined, undefined, undefined, UserRole.User); // id, username, email, phone are undefined

//       // Assert
//       expect(result.success).toBe(true);
//       expect(result.operation).toBe(CRUDOperation.READ);
//       expect(result.users).toBeDefined();
//       expect(result.user).toBeUndefined();
//       if (result.success && result.users) {
//         expect(result.users.length).toBe(2); // reader1, reader2
//         const usernames = result.users.map(u => u.username);
//         const ids = result.users.map(u => u._id);
//         expect(usernames).toContain(user1Data.username);
//         expect(usernames).toContain(user2Data.username);
//         expect(ids).toContain(user1Id);
//         expect(ids).toContain(user2Id);
//         expect(usernames).not.toContain(adminUserData.username); // Ensure admin isn't included
//         expect(ids).not.toContain(adminUserId);
//       } else {
//         fail('readUser(role: User) failed or did not return users.');
//       }
//     });

//     it('should return users matching ANY provided criteria (OR logic)', async () => {
//       // Act: Search for user1's username OR admin's email
//       const result = await readUser(undefined, user1Data.username, adminUserData.email); // id undefined

//       // Assert
//       expect(result.success).toBe(true);
//       expect(result.operation).toBe(CRUDOperation.READ);
//       expect(result.users).toBeDefined();
//       expect(result.user).toBeUndefined();
//       if (result.success && result.users) {
//         expect(result.users.length).toBe(2); // Should find both user1 and adminUser
//         const usernames = result.users.map(u => u.username);
//         const ids = result.users.map(u => u._id);
//         expect(usernames).toContain(user1Data.username);
//         expect(usernames).toContain(adminUserData.username);
//         expect(ids).toContain(user1Id);
//         expect(ids).toContain(adminUserId);
//         expect(usernames).not.toContain(user2Data.username);
//         expect(ids).not.toContain(user2Id);
//       } else {
//         fail('readUser with OR criteria failed or did not return users.');
//       }
//     });

//     it('should return only matching users if one criterion matches and another does not', async () => {
//       // Act: Search for user1's username OR a non-existent email
//       const result = await readUser(undefined, user1Data.username, 'nonexistent@email.com'); // id undefined

//       // Assert
//       expect(result.success).toBe(true);
//       expect(result.operation).toBe(CRUDOperation.READ);
//       expect(result.users).toBeDefined();
//       expect(result.user).toBeUndefined();
//       if (result.success && result.users) {
//         expect(result.users.length).toBe(1); // Should find only user 1
//         expect(result.users[0].username).toBe(user1Data.username);
//         expect(result.users[0]._id).toBe(user1Id);
//       } else {
//         fail('readUser with one matching OR criteria failed.');
//       }
//     });

//     it('should return success: true and empty array when no user matches criteria (username/email)', async () => {
//       // Act
//       const result = await readUser(undefined, 'nonexistentuser', 'nobody@nowhere.com'); // id undefined

//       // Assert
//       expect(result.success).toBe(true); // Still successful operation
//       expect(result.operation).toBe(CRUDOperation.READ);
//       expect(result.users).toBeDefined();
//       expect(result.user).toBeUndefined();
//       expect(result.users?.length).toBe(0); // Empty array
//       expect(result.message).toContain("No users found matching the specified criteria.");
//     });

//     // --- NEW: Test searching by non-existent ID ---
//     it('should return success: true and empty array when searching by non-existent ID', async () => {
//       // Generate a valid-looking but non-existent ObjectId
//       const nonExistentId = new mongoose.Types.ObjectId().toString();
//       // Act
//       const result = await readUser(nonExistentId);

//       // Assert
//       expect(result.success).toBe(true);
//       expect(result.operation).toBe(CRUDOperation.READ);
//       // IMPORTANT: Based on the current code, searching by ID when none is found
//       // still goes through the `foundUsers.length === 0` check and returns `users: []`.
//       // It does *not* return `user: undefined` in this specific failure case.
//       expect(result.users).toBeDefined();
//       expect(result.users?.length).toBe(0);
//       expect(result.user).toBeUndefined();
//       expect(result.message).toContain("No users found matching the specified criteria.");
//     });

//     // --- Optional: Test searching by invalid ID format ---
//     it('should return success: false or empty array when searching by invalid ID format', async () => {
//       const invalidId = 'this-is-not-a-valid-object-id';
//       // Act
//       const result = await readUser(invalidId);

//       // Assert
//       // Mongoose might throw an error for invalid ID format before the query,
//       // or it might proceed and find nothing. We check for either failure or empty success.
//       if (!result.success) {
//         expect(result.operation).toBe(CRUDOperation.READ);
//         expect(result.message).toContain("Error reading user"); // Expect generic error
//       } else {
//         // If it didn't error, it should return empty
//         expect(result.success).toBe(true);
//         expect(result.operation).toBe(CRUDOperation.READ);
//         expect(result.users).toBeDefined();
//         expect(result.users?.length).toBe(0);
//         expect(result.user).toBeUndefined();
//         expect(result.message).toContain("No users found matching the specified criteria.");
//       }
//     });

//   }); // End describe('readUser')

//   // --- updateUser Tests ---
//   describe('updateUser', () => {
//     const initialUsername = 'updateTestUser';
//     const initialPassword = 'initialPassword';
//     const initialEmail = 'initial@example.com';
//     const initialPhone = '1110001110';
//     let initialUserId: string;
//     let initialUser: IUserSafe | undefined; // Store the initial safe user

//     // Setup user for update tests
//     beforeEach(async () => {
//       const result = await createUser(initialUsername, initialPassword, initialEmail, initialPhone);
//       // Capture the initial state for comparison
//       if (result.success && result.user) {
//         initialUserId = result.user._id;
//         initialUser = result.user;
//       } else {
//         // Fail fast if setup fails
//         throw new Error("Failed to create initial user for updateUser tests");
//       }
//     });

//     it('should update email, phone, password, and role successfully', async () => {
//       // Arrange: Define the updates
//       const updates = {
//         email: 'updated@example.com',
//         phone: '2220002220',
//         password: 'newSecurePassword',
//         role: UserRole.Admin, // UserRole is an enum or similar type
//       };

//       // Act: Perform the update
//       const updateResult = await updateUser(initialUsername, updates);

//       // Assert: Check the result and final database state
//       expect(updateResult.success).toBe(true);

//       // Verify database state
//       const updatedUser = await userModel.findOne({ username: initialUsername });
//       expect(updatedUser).not.toBeNull();

//       if (updatedUser) { // Type guard
//         expect(updatedUser.email).toBe(updates.email);
//         expect(updatedUser.phone).toBe(updates.phone);
//         expect(updatedUser.role).toBe(updates.role);
//         expect(updatedUser.username).toBe(initialUsername); // Username should be unchanged

//         // Verify password hash
//         const passwordMatches = await bcrypt.compare(updates.password, updatedUser.password);
//         expect(passwordMatches).toBe(true);
//       } else {
//         fail("Updated user not found in DB");
//       }
//     });

//     it('should update username successfully', async () => {
//       // Arrange
//       const newUsername = 'user-renamed';
//       // Act
//       const updateResult = await updateUser(initialUsername, { username: newUsername });
//       // Assert: Check success status
//       expect(updateResult.success).toBe(true);
//       // Verify database state - query by OLD username should fail
//       const oldUser = await userModel.findOne({ username: initialUsername });
//       expect(oldUser).toBeNull();
//       // Verify database state - query by NEW username should succeed
//       const newUser = await userModel.findOne({ username: newUsername });
//       expect(newUser).not.toBeNull();
//       if (newUser) {
//         expect(newUser.username).toBe(newUsername);
//         // Check other fields remained unchanged from initial state
//         expect(newUser.email).toBe(initialEmail);
//         expect(newUser.phone).toBe(initialPhone);
//         expect(newUser.role).toBe(UserRole.User); // Initial default role
//         const passwordMatches = await bcrypt.compare(initialPassword, newUser.password);
//         expect(passwordMatches).toBe(true); // Initial password
//       } else {
//         fail("Renamed user not found in DB");
//       }
//     });

//     it("should update username successfully and return updated IUserSafe", async () => {
//       // Arrange
//       const newUsername = "user-renamed";
//       expect(initialUser).toBeDefined(); // Ensure setup worked

//       // Act
//       const result = await updateUser(initialUsername, { username: newUsername });

//       // Assert: Check the returned result object
//       expect(result.success).toBe(true);
//       expect(result.operation).toBe(CRUDOperation.UPDATE);
//       expect(result.user).toBeDefined();

//       if (result.success && result.user) {
//         // Check returned user object properties
//         expect(result.user._id).toBe(initialUserId); // ID MUST remain the same
//         expect(typeof result.user._id).toBe("string");
//         expect(result.user.username).toBe(newUsername); // Verify NEW username
//         // Verify other fields are unchanged from the initial state
//         expect(result.user.email).toBe(initialUser!.email);
//         expect(result.user.phone).toBe(initialUser!.phone);
//         expect(result.user.role).toBe(initialUser!.role);
//         expect((result.user as any).password).toBeUndefined(); // Still sanitized
//       } else {
//         fail("updateUser (username) should have succeeded but failed");
//       }

//       // Assert: Check database state consistency
//       // Verify old username no longer exists
//       const oldUserCheck = await userModel.findOne({ username: initialUsername });
//       expect(oldUserCheck).toBeNull();

//       // Verify new username exists and has correct data
//       const newUserCheck = await userModel.findOne({ username: newUsername });
//       expect(newUserCheck).not.toBeNull();
//       if (newUserCheck) {
//         expect(String(newUserCheck._id)).toBe(initialUserId); // Check ID in DB
//         expect(newUserCheck.username).toBe(newUsername);
//         expect(newUserCheck.email).toBe(initialEmail); // Check original email
//         expect(newUserCheck.phone).toBe(initialPhone); // Check original phone
//         expect(newUserCheck.role).toBe(UserRole.User); // Check original role
//         // Check password hash hasn't changed (unless explicitly updated)
//         const passwordMatches = await bcrypt.compare(
//           initialPassword,
//           newUserCheck.password
//         );
//         expect(passwordMatches).toBe(true);
//       } else {
//         fail("User with new username not found in DB");
//       }
//     });

//     it('should return success: false if trying to update a non-existent user', async () => {
//       const result = await updateUser('nonexistentuser', { email: 'a@b.com' });
//       expect(result.success).toBe(false);
//       if (result.success === false) {
//         expect(result.message).toContain('does not exist');
//       } else {
//         fail('updateUser should have failed for non-existent user but succeeded');
//       }
//     });

//     it('should return success: false if update results in no changes', async () => {
//       const result = await updateUser(initialUsername, { email: initialEmail, phone: initialPhone }); // Provide existing data
//       expect(result.success).toBe(false);
//       if (result.success === false) {
//         expect(result.message).toContain('No fields to update');
//       } else {
//         fail('updateUser should have failed (no changes) but succeeded');
//       }
//     });
//     it('should fail if updated username conflicts with another existing user', async () => {
//       // Arrange: Create a second user whose username we'll conflict with
//       const otherUserUsername = 'conflictUser';
//       await createUser(otherUserUsername, 'password', 'conflictUser@example.com', '5550005550');

//       // Act: Try to update the first user to use the second user's username
//       const result = await updateUser(initialUsername, { username: otherUserUsername });

//       // Assert
//       expect(result.success).toBe(false);
//       if (result.success === false) {
//         expect(result.message).toContain(`Username "${otherUserUsername}" is already in use`);
//       } else {
//         fail('updateUser should have failed (username conflict) but succeeded');
//       }
//     });

//     it('should fail if updated email conflicts with another existing user', async () => {
//       // Arrange: Create a second user whose email we'll conflict with
//       const otherUserEmail = 'other@example.com';
//       await createUser('otherUser', 'password', otherUserEmail, '3330003330');

//       // Act: Try to update the first user to use the second user's email
//       const result = await updateUser(initialUsername, { email: otherUserEmail });

//       // Assert
//       expect(result.success).toBe(false);
//       if (result.success === false) {
//         expect(result.message).toContain(`Email "${otherUserEmail}" is already in use`);
//       } else {
//         fail('updateUser should have failed (email conflict) but succeeded');
//       }
//     });

//     it('should fail if updated phone conflicts with another existing user', async () => {
//       // Arrange: Create a second user whose phone we'll conflict with
//       const otherUserPhone = '4440004440';
//       await createUser('otherUser2', 'password', 'otherUser2@example.com', otherUserPhone);

//       // Act: Try to update the first user to use the second user's phone
//       const result = await updateUser(initialUsername, { phone: otherUserPhone });

//       // Assert
//       expect(result.success).toBe(false);
//       if (result.success === false) {
//         expect(result.message).toContain(`Phone "${otherUserPhone}" is already in use`);
//       } else {
//         fail('updateUser should have failed (phone conflict) but succeeded');
//       }
//     });
//   });

//   // --- deleteUser Tests ---
//   describe('deleteUser', () => {
//     // Sample user for testing delete operation
//     const testUsername = 'authUser';
//     const testPassword = 'password123Secure'; // Use a known password
//     const testEmail = 'auth@example.com';
//     const testPhone = '1231231234';
//     let testUserId: string;

//     // Setup: Create the user before each authentication test
//     beforeEach(async () => {
//       // Clear the database before each test
//       await userModel.deleteMany({}); // Clear all users
//       // Create the user to be deleted
//       const res = await createUser(testUsername, testPassword, testEmail, testPhone, UserRole.User);
//       if (res.success && res.user) testUserId = res.user._id;
//     });

//     it('should delete a user successfully', async () => {
//       const res = await deleteUser(testUsername);
//       expect(res.success).toBe(true);
//       expect(res.operation).toBe(CRUDOperation.DELETE);
//       expect(res.user).toBe(undefined); // No user data on delete
//       expect(res.message).toContain('deleted successfully');
//       expect(res.message).toContain(testUsername);
//       expect(res.message).not.toContain('error'); // No error message on success
//       // Try looking with readUser to confirm deletion
//       const readResult = await readUser("",testUsername); // empty id, search username
//       expect(readResult.success).toBe(true); // Should still be successful even if no users found
//       expect(readResult.users).toBeDefined();
//       if (readResult.success && readResult.users) {
//         expect(readResult.users.length).toBe(0); // No users should be found
//         expect(readResult.message).toContain('No users found matching the specified criteria.');
//       }
//     });

//     it('should fail to delete a non-existent user', async () => {
//       const res = await deleteUser('nonExistentUser');
//       expect(res.success).toBe(false);
//       expect(res.operation).toBe(CRUDOperation.DELETE);
//       expect(res.user).toBe(undefined); // No user data on failure
//       expect(res.message).toContain('does not exist'); // Check for the specific error message
//       expect(res.message).not.toContain('deleted successfully'); // Ensure success message is not present
//     });

//     it('should fail to delete a user with an empty username', async () => {
//       const res = await deleteUser('');
//       expect(res.success).toBe(false);
//       expect(res.operation).toBe(CRUDOperation.DELETE);
//       expect(res.user).toBe(undefined); // No user data on failure
//       expect(res.message).toContain('does not exist'); // Check for the specific error message
//     });

//     it('should fail to delete the last admin user', async () => {
//       // Create a default admin
//       await connectToDatabase();
//       // Check admin count for this unit test
//       const adminCount = await userModel.countDocuments({ role: UserRole.Admin });
//       expect(adminCount).toEqual(1); // This unit test should have exactly one admin
//       // Attempt to delete the admin user
//       const res = await deleteUser('admin'); // Assuming 'admin' is the default admin username
//       expect(res.success).toBe(false);
//       expect(res.operation).toBe(CRUDOperation.DELETE);
//       expect(res.message).toContain('Cannot delete the last administrator account'); // Check for the specific error message
//       expect(res.message).not.toContain('deleted successfully'); // Ensure success message is not present
//       expect(res.user).toBe(undefined); // No user data on failure
//     });

//     it('should delete an admin if there are other admins', async () => {
//       // Arrange: Create another admin user
//       const adminUsername = 'admin2';
//       const adminPassword = 'admin2Password123';
//       const adminEmail = 'admin2@example.com';
//       const adminPhone = '12345';

//       await connectToDatabase(); // Use this to create a default admin in the empty database
//       const createResult = await createUser(adminUsername, adminPassword, adminEmail, adminPhone, UserRole.Admin);
//       expect(createResult.message).toBe(undefined);
//       expect(createResult.success).toBe(true);
//       expect(createResult.operation).toBe(CRUDOperation.CREATE);
//       expect(createResult.message).toBe(undefined);
//       expect(createResult.user).toBeDefined();
//       if (createResult.success && createResult.user) {
//         expect(createResult.user.username).toBe(adminUsername);
//         expect(createResult.user.role).toBe(UserRole.Admin);
//       }
//       // Use direct database access to check admin count
//       const adminCount = await userModel.countDocuments({ role: UserRole.Admin });
//       expect(adminCount).toEqual(2); // This unit test should have exactly two admins

//       // Act: Attempt to delete the first admin user
//       const res = await deleteUser('admin'); // The default admin username created with connectToDatabase
//       expect(res.success).toBe(true);
//       expect(res.operation).toBe(CRUDOperation.DELETE);
//       expect(res.user).toBe(undefined); // No user data on delete
//       expect(res.message).toContain('deleted successfully');
//       expect(res.message).toContain('admin'); // Check for the specific username in the message
//     });

//   });

//   // --- authenticateUser Tests ---
//   describe('authenticateUser', () => {
//     const testUsername = 'authUser';
//     const testPassword = 'password123Secure'; // Use a known password
//     const testEmail = 'auth@example.com';
//     const testPhone = '1231231234';
//     let testUserId: string;

//     // Setup: Create the user before each authentication test
//     beforeEach(async () => {
//       const res = await createUser(testUsername, testPassword, testEmail, testPhone, UserRole.User);
//       if (res.success && res.user) testUserId = res.user._id;
//     });

//     it('should authenticate successfully with correct username and password', async () => {
//       // Act
//       const result = await authenticateUser(testUsername, testPassword);

//       // Assert
//       expect(result.success).toBe(true);
//       expect(result.operation).toBe('authenticate');
//       expect(result.message).toBeUndefined(); // No error message on success
//       expect(result.user).toBeDefined();
//       if (result.success && result.user) {
//         expect(result.user._id).toBe(testUserId);
//         expect(typeof result.user._id).toBe('string');
//         expect(result.user.username).toBe(testUsername);
//         expect(result.user.email).toBe(testEmail);
//         expect(result.user.phone).toBe(testPhone);
//         expect(result.user.role).toBe(UserRole.User);
//         // Crucially, verify password is NOT included
//         expect((result.user as any).password).toBeUndefined();
//       } else {
//         fail('authenticateUser should have succeeded but failed.');
//       }
//     });
//     describe('when using incorrect credentials', () => {
//       it('should fail authentication with correct username but incorrect password', async () => {
//         // Act
//         const result = await authenticateUser(testUsername, 'wrongPassword');

//         // Assert
//         expect(result.success).toBe(false);
//         expect(result.operation).toBe('authenticate');
//         expect(result.user).toBeUndefined(); // No user data on failure
//         expect(result.message).toBe('Invalid username or password.'); // Check for the generic security message
//       });

//       it('should fail authentication with non-existent username', async () => {
//         // Act
//         const result = await authenticateUser('nonExistentUser', testPassword);

//         // Assert
//         expect(result.success).toBe(false);
//         expect(result.operation).toBe('authenticate');
//         expect(result.user).toBeUndefined();
//         expect(result.message).toBe('Invalid username or password.'); // Should be the same generic message
//       });

//       it('should fail authentication with empty string username', async () => {
//         // Act
//         const result = await authenticateUser('', testPassword);

//         // Assert
//         expect(result.success).toBe(false);
//         expect(result.operation).toBe('authenticate');
//         expect(result.user).toBeUndefined();
//         // Check the specific message returned by your input validation
//         expect(result.message).toBe('Invalid username or password.'); // Or 'Username and password are required.' depending on your implementation detail
//       });

//       it('should fail authentication with empty string password', async () => {
//         // Act
//         const result = await authenticateUser(testUsername, '');

//         // Assert
//         expect(result.success).toBe(false);
//         expect(result.operation).toBe('authenticate');
//         expect(result.user).toBeUndefined();
//         // Check the specific message returned by your input validation
//         expect(result.message).toBe('Invalid username or password.'); // Or 'Username and password are required.'
//       });
//     });
//     // Test for internal errors (e.g., database connection issue)
//     it('should return an internal error if the database query fails', async () => {
//       // Arrange: Mock userModel.findOne to simulate a DB error
//       const findOneSpy = jest.spyOn(userModel, 'findOne').mockImplementationOnce(() => {
//         return {
//           select: jest.fn().mockRejectedValueOnce(new Error('Simulated DB Error'))
//         } as any; // Need 'as any' because we're not returning a full Query object
//       });

//       // Act
//       const result = await authenticateUser(testUsername, testPassword);

//       // Assert
//       expect(result.success).toBe(false);
//       expect(result.operation).toBe('authenticate');
//       expect(result.user).toBeUndefined();
//       expect(result.message).toBe('An internal server error occurred during authentication.');
//       expect(findOneSpy).toHaveBeenCalledWith({ username: testUsername });

//       // Clean up the mock
//       findOneSpy.mockRestore();
//     });

//     // Optional: Test for internal error during password comparison (less likely)
//     it('should return an internal error if bcrypt.compare fails', async () => {
//       // Arrange: Mock bcrypt.compare to throw an error
//       const compareSpy = jest.spyOn(bcrypt, 'compare').mockImplementationOnce(async () => {
//         throw new Error('Simulated bcrypt error');
//       });

//       // Act
//       const result = await authenticateUser(testUsername, testPassword);

//       // Assert
//       expect(result.success).toBe(false);
//       expect(result.operation).toBe('authenticate');
//       expect(result.user).toBeUndefined();
//       expect(result.message).toBe('An internal server error occurred during authentication.');
//       expect(compareSpy).toHaveBeenCalled(); // Verify bcrypt.compare was called

//       // Clean up the mock
//       compareSpy.mockRestore();
//     });
//   });

// });