// // File: __tests__/project.test.ts
// // Description: This file contains unit tests for the project and project segmentation mask database models and functions.

// import { MongoMemoryServer } from 'mongodb-memory-server';
// import mongoose, { Types } from 'mongoose'; // Import Types for ObjectId
// import {
//     FileType,
//     ComponentBoundingBoxesClass,
//     IProjectDocument,
//     IProjectSegmentationMaskDocument,
//     FileDataType,
// } from '../src/types/database_types'; // Adjust path as necessary
// import {
//     connectToDatabase, // Assuming this initializes connection and checks admin
//     projectModel,
//     projectSegmentationMaskModel,
//     userModel, // Needed to create a dummy user for project association
//     createUser, // Helper to create the dummy user
//     IUserDocument, // Interface for user documents
//     IProject,
//     IProjectSegmentationMask,
//     UserRole,
//     createProject,
// } from '../src/services/database'; // Adjust path as necessary\

// // Mocking logger
// jest.mock('../src/services/logger', () => ({
//     info: jest.fn(),
//     warn: jest.fn(),
//     error: jest.fn(),
// }));

// let mongoServer: MongoMemoryServer;
// let dbUri: string;
// let testUser: IUserDocument; // To hold the created user for project association

// // Setup in-memory MongoDB server and create a test user
// beforeAll(async () => {
//     mongoServer = await MongoMemoryServer.create();
//     dbUri = mongoServer.getUri();
//     await mongoose.connect(dbUri);
//     // Create a dummy user required for project creation
//     const userResult = await createUser('projectTestUser', 'password', 'project@test.com', '9876543210', UserRole.User);
//     if (userResult.success && userResult.user) {
//         // Need the full user document to get the actual ObjectId
//         const userDoc = await userModel.findById(userResult.user._id);
//         if (!userDoc) {
//             throw new Error('Failed to retrieve created test user document.');
//         }
//         testUser = userDoc; // Store the user document for later use
//         // Sanitize the test user object to avoid circular references in the test output

//     } else {
//         throw new Error('Failed to create test user for project tests.');
//     }
// });

// // Clean up database connection
// afterAll(async () => {
//     await mongoose.disconnect();
//     await mongoServer.stop();
// });

// // Clear all collections except the user collection before each test
// beforeEach(async () => {
//     const collections = mongoose.connection.collections;
//     for (const key in collections) {
//         // Keep the user collection intact as it's needed for project tests
//         if (key !== 'users') {
//             await collections[key].deleteMany({});
//         }
//     }
// });

// // --- Project Model Tests ---
// describe('Project Model', () => {
//     // Basic connection check (relies on beforeAll)
//     it('should establish a connection to the database', () => {
//         expect(mongoose.connection.readyState).toBe(1); // 1 = connected
//     });
//     // -- Create Project Test --
//     // Assuming a NiftiGz file called "turtles.nii.gz" was uploaded
//     describe('createProject', () => {
//         it('should create a new project with all optional fields filled', async () => {
//             const projectData: IProject = {
//                 userid: String(testUser._id), // Use the test user's inherent _id
//                 name: 'Test Project',
//                 originalfilename: 'turtles',
//                 description: 'A test project description, I love turtles, I love turtles',
//                 isSaved: false,
//                 filename: `${String(testUser._id)}_2630fcede25328c13a15c4dfe6376c068201eb1f8d871736cd8197c2b1463ed3`,
//                 filetype: FileType.NIFTI_GZ,
//                 filesize: 33400000, // 33.4 MB
//                 filehash: '2630fcede25328c13a15c4dfe6376c068201eb1f8d871736cd8197c2b1463ed3',
//                 basepath: `s3://devel-visheart-s3-bucket/temp/${testUser._id}/${String(testUser._id)}_2630fcede25328c13a15c4dfe6376c068201eb1f8d871736cd8197c2b1463ed3`,
//                 originalfilepath: `s3://devel-visheart-s3-bucket/temp/${testUser._id}/${String(testUser._id)}_2630fcede25328c13a15c4dfe6376c068201eb1f8d871736cd8197c2b1463ed3/${String(testUser._id)}_2630fcede25328c13a15c4dfe6376c068201eb1f8d871736cd8197c2b1463ed3.nii.gz`,
//                 extractedfolderpath: `s3://devel-visheart-s3-bucket/temp/${testUser._id}/${String(testUser._id)}_2630fcede25328c13a15c4dfe6376c068201eb1f8d871736cd8197c2b1463ed3/extracted`,
//                 status: { upload: true, extract: true },
//                 datatype: FileDataType.FLOAT32,
//                 dimensions: { width: 216, height: 256, slices: 10, frames: 30 },
//                 voxelsize: { x: 1, y: 1, z: 1, t: 1 },
//             };

//             const result = await createProject(
//                 projectData.userid,
//                 projectData.name,
//                 projectData.originalfilename,
//                 projectData.isSaved,
//                 projectData.filename,
//                 projectData.filetype,
//                 projectData.filesize,
//                 projectData.filehash,
//                 projectData.basepath,
//                 projectData.originalfilepath,
//                 projectData.extractedfolderpath,
//                 projectData.status,
//                 projectData.datatype,
//                 projectData.dimensions,
//                 projectData.voxelsize,
//                 projectData.description,
//             );

//             // Check if the project was created successfully
//             expect(result.success).toBe(true);
//             expect(result.project).toBeDefined();
//             expect(result.project?.userid).toEqual(projectData.userid);
//             expect(result.project?.name).toEqual(projectData.name);
//             expect(result.project?.description).toEqual(projectData.description);
//             expect(result.project?.originalfilename).toEqual(projectData.originalfilename);
//             expect(result.project?.isSaved).toEqual(projectData.isSaved);
//             expect(result.project?.filename).toEqual(projectData.filename);
//             expect(result.project?.filetype).toEqual(projectData.filetype);
//             expect(result.project?.filesize).toEqual(projectData.filesize);
//             expect(result.project?.filehash).toEqual(projectData.filehash);
//             expect(result.project?.basepath).toEqual(projectData.basepath);
//             expect(result.project?.originalfilepath).toEqual(projectData.originalfilepath);
//             expect(result.project?.extractedfolderpath).toEqual(projectData.extractedfolderpath);

//             // Status, Dimensions and VoxelSize are objects, so we need to check their properties individually
//             // Status
//             expect(result.project?.status).toBeDefined();
//             expect(result.project?.status.upload).toEqual(projectData.status.upload);
//             expect(result.project?.status.extract).toEqual(projectData.status.extract);
//             expect(result.project?.datatype).toEqual(projectData.datatype);
//             // Dimensions
//             expect(result.project?.dimensions).toBeDefined();
//             expect(result.project?.dimensions.width).toEqual(projectData.dimensions.width);
//             expect(result.project?.dimensions.height).toEqual(projectData.dimensions.height);
//             expect(result.project?.dimensions.slices).toEqual(projectData.dimensions.slices);
//             expect(result.project?.dimensions.frames).toEqual(projectData.dimensions.frames);
//             // VoxelSize
//             expect(result.project?.voxelsize).toBeDefined();
//             if (result.project?.voxelsize && projectData.voxelsize) {
//                 expect(result.project.voxelsize.x).toEqual(projectData.voxelsize.x);
//                 expect(result.project.voxelsize.y).toEqual(projectData.voxelsize.y);
//                 expect(result.project.voxelsize.z).toEqual(projectData.voxelsize.z);
//                 expect(result.project.voxelsize.t).toEqual(projectData.voxelsize.t);
//             }
//             expect(result.project?.createdAt).toBeDefined();
//             expect(result.project?.updatedAt).toBeDefined();
//             expect(result.project?.createdAt).toEqual(result.project?.updatedAt);
//             expect(result.project?.createdAt).toBeInstanceOf(Date);
//             expect(result.project?.updatedAt).toBeInstanceOf(Date);
//         });
//     })
//     // -- Create Project with Required Fields Only Test --
//     it('should create a new project with required fields only', async () => {
//         const projectData: IProject = {
//             userid: String(testUser._id), // Use the test user's inherent _id
//             name: 'Test Project',
//             originalfilename: 'turtles',
//             isSaved: false,
//             filename: `${String(testUser._id)}_2630fcede25328c13a15c4dfe6376c068201eb1f8d871736cd8197c2b1463ed3`,
//             filetype: FileType.NIFTI_GZ,
//             filesize: 33400000, // 33.4 MB
//             filehash: '2630fcede25328c13a15c4dfe6376c068201eb1f8d871736cd8197c2b1463ed3',
//             basepath: `s3://devel-visheart-s3-bucket/temp/${testUser._id}/${String(testUser._id)}_2630fcede25328c13a15c4dfe6376c068201eb1f8d871736cd8197c2b1463ed3`,
//             originalfilepath: `s3://devel-visheart-s3-bucket/temp/${testUser._id}/${String(testUser._id)}_2630fcede25328c13a15c4dfe6376c068201eb1f8d871736cd8197c2b1463ed3/${String(testUser._id)}_2630fcede25328c13a15c4dfe6376c068201eb1f8d871736cd8197c2b1463ed3.nii.gz`,
//             extractedfolderpath: `s3://devel-visheart-s3-bucket/temp/${testUser._id}/${String(testUser._id)}_2630fcede25328c13a15c4dfe6376c068201eb1f8d871736cd8197c2b1463ed3/extracted`,
//             datatype: FileDataType.FLOAT32,
//             dimensions: { width: 216, height: 256, slices: 10, frames: 30 },
//             status: { upload: true, extract: true },
//         };

//         const result = await createProject(
//             projectData.userid,
//             projectData.name,
//             projectData.originalfilename,
//             projectData.isSaved,
//             projectData.filename,
//             projectData.filetype,
//             projectData.filesize,
//             projectData.filehash,
//             projectData.basepath,
//             projectData.originalfilepath,
//             projectData.extractedfolderpath,
//             projectData.status,
//             projectData.datatype,
//             projectData.dimensions,
//         );
//         // Check if the project was created successfully
//         expect(result.success).toBe(true);
//         expect(result.project).toBeDefined();
//         expect(result.project?.userid).toEqual(projectData.userid);
//         expect(result.project?.name).toEqual(projectData.name);
//         expect(result.project?.originalfilename).toEqual(projectData.originalfilename);
//         expect(result.project?.isSaved).toEqual(projectData.isSaved);
//         expect(result.project?.filename).toEqual(projectData.filename);
//         expect(result.project?.filetype).toEqual(projectData.filetype);
//         expect(result.project?.filesize).toEqual(projectData.filesize);
//         expect(result.project?.filehash).toEqual(projectData.filehash);
//         expect(result.project?.basepath).toEqual(projectData.basepath);
//         expect(result.project?.originalfilepath).toEqual(projectData.originalfilepath);
//         expect(result.project?.extractedfolderpath).toEqual(projectData.extractedfolderpath);
//         // Status, Dimensions and VoxelSize are objects, so we need to check their properties individually
//         // Status
//         expect(result.project?.status).toBeDefined();
//         expect(result.project?.status.upload).toEqual(projectData.status.upload);
//         expect(result.project?.status.extract).toEqual(projectData.status.extract);
//         // Dimensions and VoxelSize are not provided, so they should be null
//         expect(result.project?.dimensions).toBeDefined();
//         expect(result.project?.dimensions.width).toEqual(projectData.dimensions.width);
//         expect(result.project?.dimensions.height).toEqual(projectData.dimensions.height);
//         expect(result.project?.dimensions.slices).toEqual(projectData.dimensions.slices);
//         expect(result.project?.dimensions.frames).toEqual(projectData.dimensions.frames);
//         // VoxelSize is not provided, so it should be null
//         expect(result.project?.voxelsize).not.toBeDefined();
//         expect(result.project?.datatype).toBeDefined();
//         expect(result.project?.datatype).toEqual(projectData.datatype);
//         expect(result.project?.description).not.toBeDefined();
//         expect(result.project?.createdAt).toBeDefined();
//         expect(result.project?.updatedAt).toBeDefined();
//         expect(result.project?.createdAt).toEqual(result.project?.updatedAt);
//         expect(result.project?.createdAt).toBeInstanceOf(Date);
//         expect(result.project?.updatedAt).toBeInstanceOf(Date);
//     })

//     // -- Should not create a project with same name for the same user --
//     it('should not create a project with the same name for the same user', async () => {
//         const projectData: IProject = {
//             userid: String(testUser._id), // Use the test user's inherent _id
//             name: 'Test Project',
//             originalfilename: 'turtles',
//             description: 'A test project description, I love turtles, I love turtles',
//             isSaved: false,
//             filename: `${String(testUser._id)}_2630fcede25328c13a15c4dfe6376c068201eb1f8d871736cd8197c2b1463ed3`,
//             filetype: FileType.NIFTI_GZ,
//             filesize: 33400000, // 33.4 MB
//             filehash: '2630fcede25328c13a15c4dfe6376c068201eb1f8d871736cd8197c2b1463ed3',
//             basepath: `s3://devel-visheart-s3-bucket/temp/${testUser._id}/${String(testUser._id)}_2630fcede25328c13a15c4dfe6376c068201eb1f8d871736cd8197c2b1463ed3`,
//             originalfilepath: `s3://devel-visheart-s3-bucket/temp/${testUser._id}/${String(testUser._id)}_2630fcede25328c13a15c4dfe6376c068201eb1f8d871736cd8197c2b1463ed3/${String(testUser._id)}_2630fcede25328c13a15c4dfe6376c068201eb1f8d871736cd8197c2b1463ed3.nii.gz`,
//             extractedfolderpath: `s3://devel-visheart-s3-bucket/temp/${testUser._id}/${String(testUser._id)}_2630fcede25328c13a15c4dfe6376c068201eb1f8d871736cd8197c2b1463ed3/extracted`,
//             status: { upload: true, extract: true },
//             datatype: FileDataType.FLOAT32,
//             dimensions: { width: 216, height: 256, slices: 10, frames: 30 },
//             voxelsize: { x: 1, y: 1, z: 1, t: 1 },
//         };

//         const result = await createProject(
//             projectData.userid,
//             projectData.name,
//             projectData.originalfilename,
//             projectData.isSaved,
//             projectData.filename,
//             projectData.filetype,
//             projectData.filesize,
//             projectData.filehash,
//             projectData.basepath,
//             projectData.originalfilepath,
//             projectData.extractedfolderpath,
//             projectData.status,
//             projectData.datatype,
//             projectData.dimensions,
//             projectData.voxelsize,
//             projectData.description,
//         );

//         // Check if the project was created successfully
//         expect(result.success).toBe(true);
//         expect(result.project).toBeDefined();
//         expect(result.project?.userid).toEqual(projectData.userid);
//         expect(result.project?.name).toEqual(projectData.name);
//         expect(result.project?.description).toEqual(projectData.description);
//         expect(result.project?.originalfilename).toEqual(projectData.originalfilename);
//         expect(result.project?.isSaved).toEqual(projectData.isSaved);
//         expect(result.project?.filename).toEqual(projectData.filename);
//         expect(result.project?.filetype).toEqual(projectData.filetype);
//         expect(result.project?.filesize).toEqual(projectData.filesize);
//         expect(result.project?.filehash).toEqual(projectData.filehash);
//         expect(result.project?.basepath).toEqual(projectData.basepath);
//         expect(result.project?.originalfilepath).toEqual(projectData.originalfilepath);
//         expect(result.project?.extractedfolderpath).toEqual(projectData.extractedfolderpath);

//         // Status, Dimensions and VoxelSize are objects, so we need to check their properties individually
//         // Status
//         expect(result.project?.status).toBeDefined();
//         expect(result.project?.status.upload).toEqual(projectData.status.upload);
//         expect(result.project?.status.extract).toEqual(projectData.status.extract);
//         expect(result.project?.datatype).toEqual(projectData.datatype);
//         // Dimensions
//         expect(result.project?.dimensions).toBeDefined();
//         expect(result.project?.dimensions.width).toEqual(projectData.dimensions.width);
//         expect(result.project?.dimensions.height).toEqual(projectData.dimensions.height);
//         expect(result.project?.dimensions.slices).toEqual(projectData.dimensions.slices);
//         expect(result.project?.dimensions.frames).toEqual(projectData.dimensions.frames);
//         // VoxelSize
//         expect(result.project?.voxelsize).toBeDefined();
//         if (result.project?.voxelsize && projectData.voxelsize) {
//             expect(result.project.voxelsize.x).toEqual(projectData.voxelsize.x);
//             expect(result.project.voxelsize.y).toEqual(projectData.voxelsize.y);
//             expect(result.project.voxelsize.z).toEqual(projectData.voxelsize.z);
//             expect(result.project.voxelsize.t).toEqual(projectData.voxelsize.t);
//         }
//         expect(result.project?.createdAt).toBeDefined();
//         expect(result.project?.updatedAt).toBeDefined();
//         expect(result.project?.createdAt).toEqual(result.project?.updatedAt);
//         expect(result.project?.createdAt).toBeInstanceOf(Date);
//         expect(result.project?.updatedAt).toBeInstanceOf(Date);

//         // Attempt to create the same project again
//         const duplicateResult = await createProject(
//             projectData.userid,
//             projectData.name,
//             projectData.originalfilename,
//             projectData.isSaved,
//             projectData.filename,
//             projectData.filetype,
//             projectData.filesize,
//             projectData.filehash,
//             projectData.basepath,
//             projectData.originalfilepath,
//             projectData.extractedfolderpath,
//             projectData.status,
//             projectData.datatype,
//             projectData.dimensions,
//         );

//         // Check if the duplicate project creation failed
//         expect(duplicateResult.success).toBe(false);
//         expect(duplicateResult.message).toContain('Project creation failed due to uniqueness constraint violation:');
//         expect(duplicateResult.project).not.toBeDefined(); // Ensure no project was created
//     })

//     // -- Read Project Test --
//     describe('readProject', () => {
//         // Create a default project with a NiftiGz file called "turtles.nii.gz" was uploaded
//         beforeEach(async () => {
//             const projectData: IProject = {
//                 userid: String(testUser._id), // Use the test user's inherent _id
//                 name: 'Test Project',
//                 originalfilename: 'turtles',
//                 description: 'A test project description, I love turtles, I love turtles',
//                 isSaved: false,
//                 filename: `${String(testUser._id)}_2630fcede25328c13a15c4dfe6376c068201eb1f8d871736cd8197c2b1463ed3`,
//                 filetype: FileType.NIFTI_GZ,
//                 filesize: 33400000, // 33.4 MB
//                 filehash: '2630fcede25328c13a15c4dfe6376c068201eb1f8d871736cd8197c2b1463ed3',
//                 basepath: `s3://devel-visheart-s3-bucket/temp/${testUser._id}/${String(testUser._id)}_2630fcede25328c13a15c4dfe6376c068201eb1f8d871736cd8197c2b1463ed3`,
//                 originalfilepath: `s3://devel-visheart-s3-bucket/temp/${testUser._id}/${String(testUser._id)}_2630fcede25328c13a15c4dfe6376c068201eb1f8d871736cd8197c2b1463ed3/${String(testUser._id)}_2630fcede25328c13a15c4dfe6376c068201eb1f8d871736cd8197c2b1463ed3.nii.gz`,
//                 extractedfolderpath: `s3://devel-visheart-s3-bucket/temp/${testUser._id}/${String(testUser._id)}_2630fcede25328c13a15c4dfe6376c068201eb1f8d871736cd8197c2b1463ed3/extracted`,
//                 status: { upload: true, extract: true },
//                 datatype: FileDataType.FLOAT32,
//                 dimensions: { width: 216, height: 256, slices: 10, frames: 30 },
//                 voxelsize: { x: 1, y: 1, z: 1, t: 1 },
//             };

//             const result = await createProject(
//                 projectData.userid,
//                 projectData.name,
//                 projectData.originalfilename,
//                 projectData.isSaved,
//                 projectData.filename,
//                 projectData.filetype,
//                 projectData.filesize,
//                 projectData.filehash,
//                 projectData.basepath,
//                 projectData.originalfilepath,
//                 projectData.extractedfolderpath,
//                 projectData.status,
//                 projectData.datatype,
//                 projectData.dimensions,
//                 projectData.voxelsize,
//                 projectData.description,
//             );
//         })
//         it('should read a project by ID', async () => {
//             const project = await projectModel.findOne({ userid: testUser._id });
//             if (!project) {
//                 throw new Error('Project not found for the test user.');
//             }
//             const result = await projectModel.findById(project._id);
//             expect(result).toBeDefined();
//             expect(result?.userid.toString()).toEqual(String(testUser._id));
//             expect(result?.name).toEqual('Test Project');
//             expect(result?.originalfilename).toEqual('turtles');
//             expect(result?.description).toEqual('A test project description, I love turtles, I love turtles');
//         });
//     })

// });