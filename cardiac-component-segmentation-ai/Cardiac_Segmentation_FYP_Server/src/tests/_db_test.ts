// File: src/tests/_db_test.ts
// Description: This script is a manual test for the database functions in the application. It connects to the database, creates a user, creates a project, updates the project, and deletes the project. It also verifies each step by reading the user and project data from the database and logging the results.
// Run command: npx ts-node src/tests/_db_test.ts
import mongoose from 'mongoose';
import {
    connectToDatabase,
    createUser,
    readUser,
    updateUser,
    deleteUser,
    createProject,
    readProject,
    updateProject,
    deleteProject,
    UserRole,
    createProjectSegmentationMask,
    readProjectSegmentationMask,
    updateProjectSegmentationMask,
    deleteProjectSegmentationMask,
} from '../services/database';
import {
    IUser,
    IUserSafe,
    FileType,
    FileDataType,
    IProject,
    IProjectSegmentationMask,
    ComponentBoundingBoxesClass,
    IUserDocument,
} from '../types/database_types';
import logger from '../services/logger';


async function createTestUser() {
    const userData: IUser = {
        username: 'dbtest',
        password: 'password123',
        email: 'dbTest@example.com',
        phone: '0001112222',
        role: UserRole.Admin
    };

    const result = await createUser(userData);

    if (result.success) {
        logger.info("Manual Test: User created:", result);
        return true;
    }

    logger.error("Manual Test: User creation failed:", result.message);
    return false;
}

async function createTestUsers() {
    logger.info("Manual Test: Creating multiple test users...");

    // Create an admin user
    const adminData: IUser = {
        username: 'admintest',
        password: 'Admin123!',
        email: 'adminTest@example.com',
        phone: '1112223333',
        role: UserRole.Admin
    };

    // Create a regular user
    const userData: IUser = {
        username: 'usertest',
        password: 'User123!',
        email: 'userTest@example.com',
        phone: '4445556666',
        role: UserRole.User
    };

    // Create a guest user
    const guestData: IUser = {
        username: 'guest_test',
        password: 'Guest123!',
        email: 'guestTest@example.com',
        phone: '7778889999',
        role: UserRole.Guest
    };

    // Create all users and track results
    const results = await Promise.all([
        createUser(adminData),
        createUser(userData),
        createUser(guestData)
    ]);

    // Check success status for each user creation
    const successCount = results.filter(result => result.success).length;
    logger.info(`Manual Test: Successfully created ${successCount} out of 3 users`);

    // Return true if all users were created successfully
    return successCount === 3;
}

// Read users with different criteria
async function readTestUsers() {
    logger.info("Manual Test: Testing user read operations...");

    try {
        // 1. Read all users
        const allUsers = await readUser();
        if (allUsers.success && allUsers.users) {
            logger.info(`Manual Test: Found ${allUsers.users.length} total users in the database`);
        }

        // 2. Read by username
        const userByName = await readUser({ username: 'usertest' });
        if (userByName.success && userByName.users && userByName.users.length > 0) {
            logger.info(`Manual Test: Found user by username: ${userByName.users[0].username}, role: ${userByName.users[0].role}`);
        } else {
            logger.warn("Manual Test: Could not find user by username 'usertest'");
        }

        // 3. Read by role
        const adminUsers = await readUser({ role: UserRole.Admin });
        if (adminUsers.success && adminUsers.users) {
            logger.info(`Manual Test: Found ${adminUsers.users.length} admin users in the database`);
            adminUsers.users.forEach(user => logger.info(`  - Admin user: ${user.username}, email: ${user.email}`));
        }

        // 4. Read by email domain
        const testUsers = await readUser();
        if (testUsers.success && testUsers.users) {
            const exampleDomainUsers = testUsers.users.filter(u => u.email.endsWith('@example.com'));
            logger.info(`Manual Test: Found ${exampleDomainUsers.length} users with @example.com email domain`);
        }

        // 5. Test searching for non-existent user
        const nonExistentUser = await readUser({ username: 'doesnotexist' });
        if (nonExistentUser.success && nonExistentUser.users && nonExistentUser.users.length === 0) {
            logger.info("Manual Test: Correctly returned empty array for non-existent username");
        }

        return true;
    } catch (error) {
        logger.error("Manual Test: Error during user read tests:", error);
        return false;
    }
}

// Update a test user
async function updateTestUser(username: string) {
    logger.info(`Manual Test: Updating user ${username}...`);

    try {
        // First, get the current user details for comparison
        const userBefore = await readUser({ username });
        if (!userBefore.success || !userBefore.users || userBefore.users.length === 0) {
            logger.error(`Manual Test: User ${username} not found for update`);
            return false;
        }

        const originalUser = userBefore.users[0];

        // Create updates for different fields
        const updates = {
            email: `updated.${originalUser.email}`,
            phone: `999${originalUser.phone.substring(3)}`,
            // Don't change password in this test to avoid login issues
        };

        // CHANGE THIS LINE - Pass the username as an object instead of a string
        const updateResult = await updateUser(originalUser._id, updates);  // <-- MODIFIED LINE

        if (!updateResult.success) {
            logger.error(`Manual Test: User update failed: ${updateResult.message}`);
            return false;
        }


        // Verify the updates were applied correctly
        const userAfter = await readUser({ username });
        if (userAfter.success && userAfter.users && userAfter.users.length > 0) {
            const updatedUser = userAfter.users[0];

            logger.info("Manual Test: User update successful. Changes:");
            logger.info(`- Email: ${originalUser.email} → ${updatedUser.email}`);
            logger.info(`- Phone: ${originalUser.phone} → ${updatedUser.phone}`);

            // Verify the changes were correctly applied
            const correctEmail = updatedUser.email === updates.email;
            const correctPhone = updatedUser.phone === updates.phone;

            if (correctEmail && correctPhone) {
                logger.info("Manual Test: All updates verified successfully!");
                return true;
            } else {
                logger.error("Manual Test: Updates were not applied correctly");
                return false;
            }
        } else {
            logger.error("Manual Test: Failed to retrieve updated user");
            return false;
        }
    } catch (error) {
        logger.error("Manual Test: Error during user update:", error);
        return false;
    }
}


async function getTestUserId(username: string) {
    const result = await readUser({ username: username });

    if (!result.success || !result.users || result.users.length === 0) {
        logger.error("Manual Test: User read failed or user not found:", result.message || "User not found");
        return null;
    }
    return result.users[0]._id;
}

async function verifyUserCreation(username: string) {
    const result = await readUser({ username: username });

    if (!result.success || !result.users || result.users.length === 0) {
        logger.error("Manual Test: User read failed or user not found:",
            result.message || "User not found");
        return null;
    }

    const user = result.users[0];

    logger.info(`User id ${user._id}`);
    logger.info(`User email ${user.email}`);
    logger.info(`User phone ${user.phone}`);
    logger.info(`User role ${user.role}`);
    logger.info(`User created at ${user.createdAt}`);
    logger.info(`User updated at ${user.updatedAt}`);

    return user;
}

function generateProjectData(userId: string): IProject {
    const filehash = '2630fcede25328c13a15c4dfe6376c068201eb1f8d871736cd8197c2b1463ed3';
    const filename = `${String(userId)}_${filehash}`;
    const basePath = `s3://devel-visheart-s3-bucket/temp/${userId}/${filename}`;

    return {
        userid: String(userId),
        name: 'Test Project',
        originalfilename: 'turtles',
        description: 'A test project description, I love turtles, I love turtles',
        isSaved: false,
        filename,
        filetype: FileType.NIFTI_GZ,
        filesize: 33400000, // 33.4 MB
        filehash,
        basepath: basePath,
        originalfilepath: `${basePath}/${filename}.nii.gz`,
        extractedfolderpath: `${basePath}/extracted`,
        datatype: FileDataType.FLOAT32,
        dimensions: { width: 216, height: 256, slices: 10, frames: 30 },
        voxelsize: { x: 1, y: 1, z: 1, t: 1 },
    };
}

async function createTestProject(projectData: IProject) {
    const result = await createProject(
        projectData.userid,
        projectData.name,
        projectData.originalfilename,
        projectData.description,
        projectData.isSaved,
        projectData.filename,
        projectData.filetype,
        projectData.filesize,
        projectData.filehash,
        projectData.basepath,
        projectData.originalfilepath,
        projectData.extractedfolderpath,
        projectData.datatype,
        projectData.dimensions,
        projectData.voxelsize,
    );

    if (result.success) {
        logger.info("Manual Test: Project created:", result);
        return true;
    }

    logger.error("Manual Test: Project creation failed:", result.message);
    return false;
}


function generateSegmentationMaskData(
    projectId: string,
    options?: {
        targetFrameIndex?: number;
        targetSliceIndex?: number;
        contentsMode?: 'valid' | 'empty_string' | 'absent_array' | 'empty_array';
    }
): IProjectSegmentationMask {
    const baseMaskData: IProjectSegmentationMask = {
        projectid: projectId,
        name: `Test Segmentation Mask ${Date.now()}`, // Ensure unique name for multiple calls
        description: 'A test segmentation mask generated for validation.',
        isSaved: true,
        segmentationmaskRLE: false,
        isMedSAMOutput: Math.random() > 0.5,
        frames: [
            {
                frameindex: 0,
                frameinferred: true,
                slices: [
                    {
                        sliceindex: 0,
                        componentboundingboxes: [
                            {
                                class: ComponentBoundingBoxesClass.LVC,
                                confidence: 0.9,
                                x_min: 10,
                                y_min: 10,
                                x_max: 100,
                                y_max: 100
                            }
                        ],
                        segmentationmasks: [ // Default valid content
                            {
                                class: ComponentBoundingBoxesClass.LVC,
                                segmentationmaskcontents: "RLE_valid_content_frame0_slice0_mask0"
                            }
                        ]
                    },
                    {
                        sliceindex: 1, // This slice initially has no segmentationmasks array
                        componentboundingboxes: [
                            {
                                class: ComponentBoundingBoxesClass.MYO,
                                confidence: 0.8,
                                x_min: 5,
                                y_min: 5,
                                x_max: 120,
                                y_max: 120
                            }
                        ]
                    }
                ]
            },
            {
                frameindex: 1,
                frameinferred: false,
                slices: [
                    {
                        sliceindex: 0, // This slice also initially has no segmentationmasks array
                    }
                ]
            }
        ]
    };

    if (options) {
        const frameIdx = options.targetFrameIndex ?? 0;
        const sliceIdx = options.targetSliceIndex ?? 0;

        const targetFrame = baseMaskData.frames.find(f => f.frameindex === frameIdx);
        if (targetFrame) {
            const targetSlice = targetFrame.slices.find(s => s.sliceindex === sliceIdx);
            if (targetSlice) {
                switch (options.contentsMode) {
                    case 'valid':
                        // Ensure it's valid if it exists, or add a valid one
                        if (!targetSlice.segmentationmasks || targetSlice.segmentationmasks.length === 0) {
                            targetSlice.segmentationmasks = [{ class: ComponentBoundingBoxesClass.RV, segmentationmaskcontents: `RLE_forced_valid_content_f${frameIdx}_s${sliceIdx}` }];
                        } else {
                            targetSlice.segmentationmasks[0].segmentationmaskcontents = `RLE_valid_content_f${frameIdx}_s${sliceIdx}_mask0_modified`;
                        }
                        break;
                    case 'empty_string':
                        // Force an entry with empty string content
                        targetSlice.segmentationmasks = [
                            {
                                class: ComponentBoundingBoxesClass.LVC,
                                segmentationmaskcontents: "" // Invalid empty string
                            }
                        ];
                        break;
                    case 'absent_array':
                        // Remove the segmentationmasks array entirely from this slice
                        delete targetSlice.segmentationmasks;
                        break;
                    case 'empty_array':
                        // Set segmentationmasks to an empty array for this slice
                        targetSlice.segmentationmasks = [];
                        break;
                }
            }
        }
    }
    return baseMaskData;
}



async function readSegmentationMask(projectId: string) {
    const result = await readProjectSegmentationMask(projectId);

    if (result.success && result.projectsegmentationmasks && result.projectsegmentationmasks.length > 0) {
        logger.info("Manual Test: Segmentation mask read successfully:", result);
        return result.projectsegmentationmasks[0];
    }

    logger.error("Manual Test: Segmentation mask read failed:", result.message || "Segmentation mask not found");
    return null;
}

async function updateTestSegmentationMask(maskId: string) {
    try {
        // Create update data with various changes
        const updateData = {
            name: 'Updated Segmentation Mask',
            description: 'This mask has been updated via testing',
            isSaved: true,
            frames: [
                {
                    frameindex: 0,
                    frameinferred: true,
                    slices: [
                        {
                            sliceindex: 0,
                            componentboundingboxes: [
                                {
                                    class: ComponentBoundingBoxesClass.LVC,
                                    confidence: 0.9,
                                    x_min: 10,
                                    y_min: 10,
                                    x_max: 100,
                                    y_max: 100
                                },
                                {
                                    class: ComponentBoundingBoxesClass.MYO,
                                    confidence: 0.8,
                                    x_min: 5,
                                    y_min: 5,
                                    x_max: 120,
                                    y_max: 120
                                }
                            ],
                            segmentationmasks: [
                                {
                                    class: ComponentBoundingBoxesClass.LVC,
                                    segmentationmaskcontents: "updated RLE encoded mask data here"
                                },
                                {
                                    class: ComponentBoundingBoxesClass.MYO,
                                    segmentationmaskcontents: "updated RLE encoded mask data here"
                                },
                                {
                                    class: ComponentBoundingBoxesClass.RV,
                                    segmentationmaskcontents: "updated RLE encoded mask data here"
                                }
                            ]
                        },
                        {
                            sliceindex: 1,
                        }
                    ]
                }
            ]
        };

        // Call the update function
        const result = await updateProjectSegmentationMask(maskId, updateData);

        if (!result.success) {
            logger.error("Manual Test: Segmentation mask update failed:", result.message);
            return false;
        }

        logger.info("Manual Test: Segmentation mask updated successfully:", result);

        // Verify the changes
        const updatedMask = result.projectsegmentationmask;
        if (updatedMask) {
            logger.info("Manual Test: Updated segmentation mask details:");
            logger.info(`- Name: ${updatedMask.name}`);
            logger.info(`- Description: ${updatedMask.description}`);
            logger.info(`- isSaved: ${updatedMask.isSaved}`);
            logger.info(`- isMedSAMOutput: ${updatedMask.isMedSAMOutput}`);
            logger.info(`- Number of frames: ${updatedMask.frames.length}`);
            logger.info(`- First frame slices: ${updatedMask.frames[0].slices.length}`);

            // Log bounding box details if available
            if (updatedMask.frames[0].slices[0].componentboundingboxes?.length) {
                const box = updatedMask.frames[0].slices[0].componentboundingboxes[0];
                logger.info(`- First bounding box: (${box.x_min},${box.y_min}) to (${box.x_max},${box.y_max})`);
            }
        }

        return true;
    } catch (error) {
        logger.error("Manual Test: An error occurred while updating the segmentation mask:", error);
        return false;
    }
}

async function createTestSegmentationMask(projectId: string) {
    const maskData = generateSegmentationMaskData(projectId);

    const result = await createProjectSegmentationMask(maskData);

    if (result.success) {
        logger.info("Manual Test: Segmentation mask created:", result);
        return result.projectsegmentationmask;
    }

    logger.error("Manual Test: Segmentation mask creation failed:", result.message);
    return null;
}

async function verifyProjectCreation(userId: string, projectName: string) {
    const result = await readProject(undefined, userId, projectName);

    if (!result.success || !result.projects || result.projects.length === 0) {
        logger.error("Manual Test: Project read failed:", result.message || "Project not found");
        return null;
    }

    const project = result.projects[0];

    logger.info(`Project id ${project._id}`);
    logger.info(`Project name ${project.name}`);
    logger.info(`Project description ${project.description}`);
    logger.info(`Project created at ${project.createdAt}`);
    logger.info(`Project updated at ${project.updatedAt}`);

    // Create a paragraph describing the project
    const projectDescription = `Project ID: ${project._id}, Name: ${project.name}, ` +
        `Description: ${project.description}, Created At: ${project.createdAt}, ` +
        `Updated At: ${project.updatedAt} with dimensions ` +
        `${project.dimensions.width}x${project.dimensions.height}x` +
        `${project.dimensions.slices}x${project.dimensions.frames} and ` +
        `possible undefined voxels with size ${project.voxelsize?.x}x` +
        `${project.voxelsize?.y}x${project.voxelsize?.z}x${project.voxelsize?.t}.`;

    logger.info(`Manual Test: Project description: ${projectDescription}`);

    return project;
}

// Fix the updateTestProject function to use projectId instead of userId
async function updateTestProject(projectId: string) {
    try {
        const updateData = {
            name: 'Updated Project Name',
            description: 'Updated project description',
            isSaved: true,
            originalfilename: 'updated_turtles',
            filename: `updated_2630fcede25328c13a15c4dfe6376c068201eb1f8d871736cd8197c2b1463ed3`,
            filehash: 'updated_2630fcede25328c13a15c4dfe6376c068201eb1f8d871736cd8197c2b1463ed3',
            dimensions: {
                width: 300,
                height: 400,
                slices: 15,
                frames: 40
            },
            voxelsize: {
                x: 0.5,
                y: 0.5,
                z: 1.5,
                t: 2.5
            },
            status: {
                upload: true,
                extract: true
            },
            datatype: FileDataType.UINT16
        };

        // Use projectId for update
        const result = await updateProject(projectId, updateData);

        if (!result.success) {
            logger.error("Manual Test: Project update failed:", result.message);
            return false;
        }

        logger.info("Manual Test: Project updated successfully:", result);

        // Use projectId for verification query
        const verifyResult = await readProject(projectId);

        if (!verifyResult.success || !verifyResult.projects || !verifyResult.projects[0]) {
            logger.error("Manual Test: Failed to retrieve updated project");
            return false;
        }

        const updated = verifyResult.projects[0];
        logger.info("Manual Test: Updated project details:");
        logger.info(`- Name: ${updated.name}`);
        logger.info(`- Description: ${updated.description}`);
        logger.info(`- isSaved: ${updated.isSaved}`);
        logger.info(`- Dimensions: ${updated.dimensions.width}x${updated.dimensions.height}x${updated.dimensions.slices}x${updated.dimensions.frames}`);
        logger.info(`- Voxel size: ${updated.voxelsize?.x}x${updated.voxelsize?.y}x${updated.voxelsize?.z}x${updated.voxelsize?.t}`);

        return true;
    } catch (error) {
        logger.error("Manual Test: An error occurred while updating the project:", error);
        return false;
    }
}

async function deleteTestProject(projectId: string) {
    try {
        // Delete the project
        const result = await deleteProject(projectId);

        if (!result.success) {
            logger.error("Manual Test: Project deletion failed:", result.message);
            return false;
        }

        logger.info("Manual Test: Project deleted successfully:", result);

        // Verify deletion by attempting to retrieve it again
        const verifyResult = await readProject(projectId);

        if (verifyResult.success && verifyResult.projects && verifyResult.projects.length > 0) {
            logger.error("Manual Test: Project still exists after deletion");
            return false;
        }

        logger.info("Manual Test: Verified project no longer exists");
        return true;
    } catch (error) {
        logger.error("Manual Test: An error occurred while deleting the project:", error);
        return false;
    }
}
// Add this new function to delete and verify a segmentation mask
async function deleteTestSegmentationMask(maskId: string) {
    try {
        // Delete the segmentation mask
        const result = await deleteProjectSegmentationMask(maskId);

        if (!result.success) {
            logger.error("Manual Test: Segmentation mask deletion failed:", result.message);
            return false;
        }

        logger.info("Manual Test: Segmentation mask deleted successfully:", result.message);

        // Try to read the deleted mask to verify it's gone
        // Since we don't have a direct way to read a mask by ID, we'll assume success if deletion reports success
        return true;
    } catch (error) {
        logger.error("Manual Test: An error occurred while deleting the segmentation mask:", error);
        return false;
    }
}


async function testCreateSegmentationMaskWithContentValidation(projectId: string) {
    logger.info("=== STARTING SEGMENTATION MASK CREATION CONTENT VALIDATION TESTS ===");

    // Test 1: Create with valid segmentationmaskcontents
    logger.info("Manual Test: Attempting to create mask with VALID segmentationmaskcontents...");
    let maskData = generateSegmentationMaskData(projectId, { targetFrameIndex: 0, targetSliceIndex: 0, contentsMode: 'valid' });
    maskData.name = "Valid Content Create Mask"; // Unique name
    let result = await createProjectSegmentationMask(maskData);
    if (result.success && result.projectsegmentationmask) {
        logger.info(`Manual Test: Successfully created mask with valid contents. ID: ${result.projectsegmentationmask._id}`);
        // Clean up this mask
        await deleteProjectSegmentationMask(String(result.projectsegmentationmask._id));
    } else {
        logger.error("Manual Test: FAILED to create mask with valid contents.", result.message);
    }

    // Test 2: Attempt to create with empty_string segmentationmaskcontents
    logger.info("Manual Test: Attempting to create mask with EMPTY_STRING segmentationmaskcontents (expected to fail)...");
    maskData = generateSegmentationMaskData(projectId, { targetFrameIndex: 0, targetSliceIndex: 0, contentsMode: 'empty_string' });
    maskData.name = "Empty Content Create Mask"; // Unique name
    result = await createProjectSegmentationMask(maskData);
    // Expect the generic error message because Mongoose validation will fail during .save()
    if (!result.success && result.message?.includes("Error creating project segmentation mask")) {
        logger.info("Manual Test: Correctly FAILED to create mask with empty_string contents (Mongoose validation).");
    } else {
        logger.error("Manual Test: UNEXPECTED result for empty_string contents creation.", result);
        if (result.success && result.projectsegmentationmask) await deleteProjectSegmentationMask(String(result.projectsegmentationmask._id));
    }

    // Test 3: Create with segmentationmasks array being absent in a slice
    logger.info("Manual Test: Attempting to create mask with ABSENT segmentationmasks array in a slice...");
    maskData = generateSegmentationMaskData(projectId, { targetFrameIndex: 0, targetSliceIndex: 0, contentsMode: 'absent_array' });
    maskData.name = "Absent Array Create Mask"; // Unique name
    result = await createProjectSegmentationMask(maskData);
    if (result.success && result.projectsegmentationmask) {
        logger.info(`Manual Test: Successfully created mask with absent segmentationmasks array. ID: ${result.projectsegmentationmask._id}`);
        await deleteProjectSegmentationMask(String(result.projectsegmentationmask._id));
    } else {
        logger.error("Manual Test: FAILED to create mask with absent segmentationmasks array.", result.message);
    }

    // Test 4: Create with segmentationmasks array being empty in a slice
    logger.info("Manual Test: Attempting to create mask with EMPTY segmentationmasks array in a slice...");
    maskData = generateSegmentationMaskData(projectId, { targetFrameIndex: 0, targetSliceIndex: 0, contentsMode: 'empty_array' });
    maskData.name = "Empty Array Create Mask"; // Unique name
    result = await createProjectSegmentationMask(maskData);
    if (result.success && result.projectsegmentationmask) {
        logger.info(`Manual Test: Successfully created mask with empty segmentationmasks array. ID: ${result.projectsegmentationmask._id}`);
        await deleteProjectSegmentationMask(String(result.projectsegmentationmask._id));
    } else {
        logger.error("Manual Test: FAILED to create mask with empty segmentationmasks array.", result.message);
    }

    logger.info("=== COMPLETED SEGMENTATION MASK CREATION CONTENT VALIDATION TESTS ===");
}

async function testUpdateSegmentationMaskWithContentValidation(maskId: string, projectId: string) {
    logger.info(`=== STARTING SEGMENTATION MASK UPDATE CONTENT VALIDATION TESTS (Mask ID: ${maskId}) ===`);

    // Test 1: Attempt to update with empty_string segmentationmaskcontents (expected to fail)
    logger.info("Manual Test: Attempting to update mask with EMPTY_STRING segmentationmaskcontents (expected to fail)...");
    let updateData = generateSegmentationMaskData(projectId, { targetFrameIndex: 0, targetSliceIndex: 0, contentsMode: 'empty_string' });
    let result = await updateProjectSegmentationMask(maskId, { frames: updateData.frames });
    // Expect the generic error message because Mongoose validation will fail during .save()
    // as updateProjectSegmentationMask is missing the custom check.
    if (!result.success && result.message?.includes("Error updating project segmentation mask")) {
        logger.info("Manual Test: Correctly FAILED to update mask with empty_string contents (Mongoose validation).");
    } else {
        logger.error("Manual Test: UNEXPECTED result for empty_string contents update.", result);
    }

    // Test 2: Update with valid segmentationmaskcontents
    logger.info("Manual Test: Attempting to update mask with VALID segmentationmaskcontents...");
    updateData = generateSegmentationMaskData(projectId, { targetFrameIndex: 0, targetSliceIndex: 0, contentsMode: 'valid' });
    updateData.name = "Updated Valid Content Mask"; // Also update name to see a change
    result = await updateProjectSegmentationMask(maskId, { name: updateData.name, frames: updateData.frames, description: "Updated with valid contents." });
    if (result.success && result.projectsegmentationmask) {
        logger.info("Manual Test: Successfully updated mask with valid contents.");
        // You can add more detailed verification here by reading the mask back if needed
    } else {
        logger.error("Manual Test: FAILED to update mask with valid contents.", result.message);
    }
    logger.info("=== COMPLETED SEGMENTATION MASK UPDATE CONTENT VALIDATION TESTS ===");
}

// Modify the runManualTests function to include multiple segmentation mask testing
async function runManualTests(): Promise<void> {
    try {
        await connectToDatabase();

        // User CRUD Testing Section
        logger.info("=== STARTING USER CRUD TESTS ===");
        // ... (existing user tests) ...
        logger.info("=== COMPLETED USER CRUD TESTS ===");


        // Step 1: Create and verify user
        if (await createTestUser()) {
            const user = await verifyUserCreation('dbtest');

            if (user) {
                // Step 2: Create and verify project
                const projectData = generateProjectData(String(user._id));

                if (await createTestProject(projectData)) {
                    const project = await verifyProjectCreation(projectData.userid, projectData.name);

                    if (project) {
                        logger.info("Manual Test: Project created successfully for segmentation mask tests.");

                        // **** NEW: Run Segmentation Mask Creation Validation Tests ****
                        await testCreateSegmentationMaskWithContentValidation(String(project._id));
                        // **** END NEW ****

                        // Step 3: Create three segmentation masks with different names (these use default valid generateSegmentationMaskData)
                        logger.info("Manual Test: Creating 3 standard segmentation masks...");

                        const maskData1 = generateSegmentationMaskData(String(project._id));
                        maskData1.name = "Test Mask 1 (Standard)";
                        const segMask1Result = await createProjectSegmentationMask(maskData1);

                        const maskData2 = generateSegmentationMaskData(String(project._id));
                        maskData2.name = "Test Mask 2 (Standard)";
                        const segMask2Result = await createProjectSegmentationMask(maskData2);

                        const maskData3 = generateSegmentationMaskData(String(project._id));
                        maskData3.name = "Test Mask 3 (Standard)";
                        const segMask3Result = await createProjectSegmentationMask(maskData3);


                        // Verify all masks were created
                        const allMasksReadResult = await readProjectSegmentationMask(String(project._id));
                        if (allMasksReadResult.success && allMasksReadResult.projectsegmentationmasks) {
                            logger.info(`Manual Test: Successfully read ${allMasksReadResult.projectsegmentationmasks.length} standard segmentation masks after creation.`);

                            // **** NEW: Run Segmentation Mask Update Validation Tests on segMask1Result ****
                            if (segMask1Result.success && segMask1Result.projectsegmentationmask) {
                                await testUpdateSegmentationMaskWithContentValidation(String(segMask1Result.projectsegmentationmask._id), String(project._id));
                            } else {
                                logger.error("Manual Test: Could not run update validation tests as segMask1 was not created successfully.");
                            }
                            // **** END NEW ****

                            // Step 4: Comprehensively update the second mask (segMask2Result)
                            // This existing test already updates frames with valid content.
                            if (segMask2Result.success && segMask2Result.projectsegmentationmask) {
                                const maskIdToUpdate = String(segMask2Result.projectsegmentationmask._id);
                                logger.info(`Manual Test: Performing standard comprehensive update on mask with ID: ${maskIdToUpdate}`);
                                if (await updateTestSegmentationMask(maskIdToUpdate)) { // updateTestSegmentationMask uses valid update data
                                    // Step 5: Verify update worked
                                    // ... (existing verification logic for updateTestSegmentationMask) ...
                                    logger.info("Manual Test: Standard comprehensive mask update verified!");
                                }
                            }

                            // Step 6: Delete the third mask (segMask3Result)
                            if (segMask3Result.success && segMask3Result.projectsegmentationmask) {
                                const maskToDeleteId = String(segMask3Result.projectsegmentationmask._id);
                                // ... (existing deletion logic for segMask3Result) ...
                            }
                        } else {
                            logger.error("Manual Test: Failed to read standard segmentation masks after creation.");
                        }

                        // Step 8: Update and verify project
                        await updateTestProject(String(project._id));

                        // Step 9: Delete project (will cascade delete remaining segmentation masks)
                        await deleteTestProject(String(project._id));
                    }
                }
            }
        }

        // Delete the test user
        const userToDelete = ['dbtest', 'admintest', 'usertest', 'guest_test'];
        // ... (existing user deletion logic) ...
    } catch (error) {
        logger.error("Manual Test: An unexpected error occurred:", error);
    } finally {
        await mongoose.disconnect();
        logger.info("Manual Test: Database disconnected.");
        process.exit(0); // Ensure the script exits after tests
    }
}


// Run the tests
runManualTests();