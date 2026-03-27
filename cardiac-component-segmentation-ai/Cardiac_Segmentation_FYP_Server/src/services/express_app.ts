import express, { Request, Response } from 'express';
import session from 'express-session';
import passport from 'passport';
import { RedisStore } from 'connect-redis';
import { redisClient } from './redis';
import authenticationRoute from '../routes/authentication';
import projectRoute from '../routes/project_routes';
import webhookRoute from '../routes/webhook_routes';
import debugRoute from '../routes/debug_routes';
import segmentationRoutes from '../routes/segmentation_routes';
import reconstructionRoutes from '../routes/reconstruction_routes';
import gpuStatusRoute from '../routes/gpu_status';
import adminToolsRoute from '../routes/admin_tools';
import sampleNiftiRoute from '../routes/sample_nifti';
import cpuMetricsRoute from '../routes/cpu_metrics';
import ecrMetricsRoute from '../routes/ecr_metrics';
import s3MetricsRoute from '../routes/s3_metrics';
import albMetricsRoute from '../routes/alb_metrics';
import billingMetricsRoute from '../routes/billing_metrics';
import asgMetricsRoute from '../routes/asg_metrics';
import logger from './logger';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import helmet from 'helmet';

// Create express app instance
const app = express();
const serviceLocation = "ExpressApp"; // For logging context

/* Middleware */
// Apply essential middleware like parsing JSON bodies
app.use(express.json({ limit: '10mb' })); // Increase limit for large JSON payloads (for webhook callback)

// Setup Redis session store
const redisStore = new RedisStore({
  client: redisClient,
  prefix: 'visheart:',
});


// Get environment type
const envType = process.env.NODE_ENV || 'development'; // Default to 'development' if not set


// Configure express-session with Redis store
// Note: Ensure SESSION_SECRET is loaded before this runs (e.g., via dotenv in index.ts)

// the middleware runs for every incoming request to your application, including /register, /login, and /logout.
// When a request comes in, the express-session middleware will look for a session cookie.
// If one exists, it will try to load the corresponding session from your Redis store and make it available on req.session.
// If no session cookie exists, it will prepare a new, uninitialized session object on req.session.
app.use(
  session({
    store: redisStore,
    secret: process.env.SESSION_SECRET || 'default_secret',
    resave: false,

    // This setting tells express-session not to save a session to the store (Redis)
    // if it's new and hasn't been modified during the request.

    // the /register route handles creating a user in your database.
    // However, it does not modify req.session or call req.logIn.
    // Because saveUninitialized: false is set, even though the session middleware runs for /register,
    // a session will not be saved to Redis by this route handler.
    // A session ID might be generated and sent back as a cookie to the client,
    // but the corresponding session data won't be stored in Redis until something is saved to req.session.
    saveUninitialized: false,
    cookie: {
      secure: envType === 'production', // Use secure cookies in production
      httpOnly: true,
      sameSite: 'lax', // Allow cross-site requests 
      maxAge: 1000 * 60 * 60 * 24, // 1 day
    },
  })
)

// Enable CORS for all routes
let corsOriginConfig: cors.CorsOptions['origin'];

if (envType === 'development') {
  corsOriginConfig = true; // Allow all origins in development
  logger.info(`${serviceLocation}: CORS configured to allow all origins (development mode).`);
} else {
  const allowedOrigins: string[] = [];
  if (process.env.CORS_ORIGIN) {
    // Split the CORS_ORIGIN string by comma and add each origin to the array
    process.env.CORS_ORIGIN.split(',').forEach(origin => {
      allowedOrigins.push(origin.trim()); // trim whitespace
    });
  }
  if (process.env.GPU_SERVER_ORIGIN_FOR_CALLBACK) {
    allowedOrigins.push(process.env.GPU_SERVER_ORIGIN_FOR_CALLBACK.trim());
  }

  if (allowedOrigins.length > 0) {
    corsOriginConfig = allowedOrigins;
    logger.info(`${serviceLocation}: CORS configured for specific origins: ${allowedOrigins.join(', ')} (production mode).`);
  } else {
    // Fallback if no specific origins are set for production.
    // This makes CORS restrictive by default in production if no origins are specified.
    corsOriginConfig = false;
    logger.warn(`${serviceLocation}: CORS_ORIGIN and GPU_SERVER_ORIGIN_FOR_CALLBACK are not set in production. CORS will be disabled or highly restrictive unless specific routes override it.`);
  }
}

app.use(cors({
  origin: corsOriginConfig,
  credentials: true, // Allow credentials (cookies) to be sent
}));
app.use(
  helmet({
    contentSecurityPolicy: false,
  })
);

// Trust proxy to properly read X-Forwarded-For header
app.set("trust proxy", "loopback");

// Initialize Passport.js
app.use(passport.initialize());
app.use(passport.session()); // Enable persistent login sessions

/* Routes */
// Mount authentication routes under '/auth'
app.use('/auth', authenticationRoute);

// Mount upload routes under root path
app.use('/project', projectRoute);

// Mount GPU webhook routes under root path
app.use('/webhook', webhookRoute);

// Debug Route
if (envType === 'development') {
  app.use(debugRoute); // Mount debug routes only in development mode
  logger.info(`${serviceLocation}: Debug routes mounted for development environment`);
}

// Segmentation Data Routes
app.use('/segmentation', segmentationRoutes); // Mount the segmentation routes

// 4D Reconstruction Routes
app.use('/reconstruction', reconstructionRoutes); // Mount the 4D reconstruction routes

// Status Routes (mount under '/status')
app.use('/status', gpuStatusRoute); // Mount GPU status routes

// Admin Tool Routes
app.use('/admintools', adminToolsRoute);

// ECR Metrics Routes
app.use('/ecr', ecrMetricsRoute);

// S3 Metrics Routes
app.use('/metrics/s3', s3MetricsRoute);

// ALB Metrics Routes
app.use('/metrics/alb', albMetricsRoute);

// ASG Metrics Routes
app.use('/metrics/asg', asgMetricsRoute);

// Billing Metrics Routes
app.use('/metrics/billing', billingMetricsRoute);

// CPU Metrics Routes
app.use('/metrics', cpuMetricsRoute);

// Sample NIfTI Routes
app.use('/sample-nifti', sampleNiftiRoute);

// Return simple server status when accessing the root path
app.get('/', (req: Request, res: Response) => {
  res.status(200).json({
    message: 'Visheart API Server is running',
    environment: envType,
  });
});

// Configure static file serving
// const configureStaticFiles = (): void => {
//   // Define base paths
//   const publicDir = path.join(__dirname, '../../public');
//   const publicAssetsDir = path.join(__dirname, '../../public/assets');
//   const indexHtmlPath = path.join(publicDir, 'index.html');

//   // Verify that the public directory exists
//   if (!fs.existsSync(publicDir)) {
//     logger.warn(${serviceLocation}: Public directory not found at ${publicDir});
//   }

//   // Configure static file middleware with caching options
//   const staticOptions = {
//     maxAge: envType === 'production' ? '1d' : 0, // Cache for 1 day in production
//     etag: true,
//   };

//   // Serve static files from the 'public' directory
//   app.use(express.static(publicDir, staticOptions));

//   // Serve assets with specific route
//   app.use('/assets', express.static(publicAssetsDir, staticOptions));

//   // SPA fallback - serve index.html for any unmatched routes
//   app.get('*', (req: Request, res: Response) => {
//     if (fs.existsSync(indexHtmlPath)) {
//       res.sendFile(indexHtmlPath);
//     } else {
//       logger.error(${serviceLocation}: index.html not found at ${indexHtmlPath});
//       res.status(404).send('Application entry point not found');
//     }
//   });

// logger.info(${serviceLocation}: Static file serving configured);
// };

// Apply static file configuration
// configureStaticFiles();

// Export the configured app instance
export { app };
