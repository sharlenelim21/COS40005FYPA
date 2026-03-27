// import axios from 'axios';   
// import { app } from '../src/services/express_app';
// import mongoose from "mongoose";
// import { MongoMemoryServer } from 'mongodb-memory-server';
// import http from 'http';
// import fs from 'fs';
// import path from 'path';
// import FormData from 'form-data';

// // Mocking logger to prevent console output during tests
// jest.mock('../src/services/logger', () => ({
//   info: jest.fn(),
//   warn: jest.fn(),
//   error: jest.fn()
// }));

// let mongoServer: MongoMemoryServer;
// let dbUri: string;
// let server: http.Server;
// let baseURL: string;

// beforeAll(async () => {
//   // Setup in-memory MongoDB server
//   if (mongoose.connection.readyState !== 1) {
//     mongoServer = await MongoMemoryServer.create();
//     dbUri = mongoServer.getUri();
//     await mongoose.connect(dbUri);
//   }

//   server = app.listen(0); // Start server on a random available port
//   const port = (server.address() as any).port;
//   baseURL = `http://localhost:${port}`;
// });

// afterAll(async () => {
//   await mongoose.disconnect();
//   if (mongoServer) {
//     await mongoServer.stop();
//   }
//   if (server) {
//     await new Promise((resolve) => server.close(resolve));
//   }
// });

// beforeEach(async () => {
//   const collections = mongoose.connection.collections;
//   for (const key in collections) {
//     await collections[key].deleteMany({});
//   }
// });

// describe('Authentication Tests', () => {
//   describe('Register Functionality', () => {
//     it('should register a new user successfully', async () => {
//       const response = await axios.post(`${baseURL}/auth/register`, {
//         username: 'testuser',
//         password: 'password123',
//         email: 'testuser@example.com',
//         phone: '1234345654345690',
//       });

//       const data = response.data as { message: string; username?: string };

//       expect(response.status).toBe(201); 
//       expect(data.message).toContain("Registration successful");
//       expect(data.username).toBe('testuser');
//     });

//     it('should detect duplicate registration and return an error', async () => {
//       await axios.post(`${baseURL}/auth/register`, {
//         username: 'jesmineting',
//         password: 'jesmine123',
//         email: 'jesmine@example.com',
//         phone: '8221139',
//       });

//       try {
//         await axios.post(`${baseURL}/auth/register`, {
//           username: 'jesmineting',
//           password: 'jesmine123',
//           email: 'jesmine@example.com',
//           phone: '8221139',
//         });
//       } catch (error: any) {
//         const data = error.response.data as { message: string };

//         expect(error.response.status).toBe(400);
//         expect(data.message).toContain("User already exists");
//       }
//     });

//     it('should register a user with non-English characters in username and email', async () => {
//       const response = await axios.post(`${baseURL}/auth/register`, {
//         username: '测试用户', 
//         password: 'password123',
//         email: '测试用户@example.com',
//         phone: '1234345654345690',
//       });

//       const data = response.data as { message: string; username?: string };

//       expect(response.status).toBe(201);
//       expect(data.message).toContain("Registration successful");
//       expect(data.username).toBe('测试用户');
//     });
//   });

//   describe('Login Functionality', () => {
//     it('should fail to log in a user who is not registered', async () => {
//       try {
//         await axios.post(`${baseURL}/auth/login`, {
//           username: 'unregistereduser',
//           password: 'password123',
//         });
//       } catch (error: any) {

//         expect(error.response.status).toBe(401);
//         expect(error.response.data.message).toContain("Invalid username or password.");
//       }
//     });

//     it('should register and log in successfully', async () => {
//       // Register the user
//       const response = await axios.post(`${baseURL}/auth/register`, {
//         username: 'testuser',
//         password: 'password123',
//         email: 'testuser@example.com',
//         phone: '1234345654345690',
//       });

//       const regData = response.data as { message: string; username?: string };

//       expect(response.status).toBe(201); 
//       expect(regData.message).toContain("Registration successful");
//       expect(regData.username).toBe('testuser');

//       // Log in with the registered user
//       const loginResponse = await axios.post(`${baseURL}/auth/login`, {
//         username: 'testuser',
//         password: 'password123',
//       });

//       const loginData = loginResponse.data as {
//         login: boolean;
//         username?: string;
//         message: string;
//       };

//       expect(loginResponse.status).toBe(200);
//       expect(loginData.login).toBe(true);
//       expect(loginData.username).toBe('testuser');
//       expect(loginData.message).toContain("Login successful.");
//     });

//     it('should log in as a guest successfully', async () => {
//       const response = await axios.post(`${baseURL}/auth/guest`);

//       const data = response.data as {
//         login: boolean;
//         guest: boolean;
//         username: string;
//         role: string;
//         message: string;
//       };

//       expect(response.status).toBe(200);
//       expect(data.login).toBe(true);
//       expect(data.guest).toBe(true);
//       expect(data.username.startsWith('guest_')).toBe(true);
//       expect(data.role).toBeDefined();
//       expect(data.message).toContain("Logged in as guest.");
//     });
//   });

//   // describe('Image Upload Functionality', () => {
//   //   it('should upload an image and extract metadata correctly', async () => {
//   //     // Path to the image file to be uploaded
//   //     const imagePath = "C:\\Users\\Clarissa\\OneDrive - Swinburne University Of Technology Sarawak Campus\\Pictures\\testing\\testing_upload.jpeg";

//   //     // Create a FormData instance to simulate a multipart form upload
//   //     const formData = new FormData();
//   //     formData.append('file', fs.createReadStream(imagePath));

//   //     // Send the POST request to upload the image
//   //     interface UploadResponse {
//   //       message: string;
//   //       metadata?: {
//   //         createdBy: string;
//   //       };
//   //     }

//   //     const response = await axios.post<UploadResponse>(`${baseURL}api/upload`, formData, {
//   //       headers: {
//   //         ...formData.getHeaders(),
//   //         'Content-Type': 'multipart/form-data',
//   //       }
//   //     });

//   //     // Check if the upload was successful
//   //     expect(response.status).toBe(200);
//   //     expect(response.data.message).toBe('Image uploaded successfully');

//   //     // Extract the image metadata from the response (assuming metadata is returned)
//   //     const metadata = response.data.metadata;
//   //     expect(metadata).toBeDefined();
//   //     if (metadata) {
//   //       expect(metadata.createdBy).toBeDefined();
//   //     } else {
//   //       fail('Metadata is undefined');
//   //     }
//   //     expect(metadata.createdBy).toBe('testuser'); // Assuming the uploaded image has a 'createdBy' field
//   //   });
//   // });

//   // describe('Logout Functionality', () => {
//   //   it('should not log out successfully as there is no session', async () => {
//   //     try {
//   //       await axios.post(`${baseURL}/auth/logout`);
//   //     } catch (error: any) {
//   //       const data = error.response.data as { message: string };
//   //       expect(error.response.status).toBe(401);
//   //       expect(data.message).toContain("User not logged in");
//   //     }
//   //   });
//   // });
// });
