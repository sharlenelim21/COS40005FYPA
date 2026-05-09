import express, { Request, Response } from 'express';
import net from 'net';
import tls from 'tls';
import logger from '../services/logger';
import { userModel, UserRole } from '../services/database';

const router = express.Router();
const serviceLocation = 'SupportRoutes';

const docs = [
  {
    tab: 'introduction',
    title: 'Introduction to VisHeart',
    excerpt: 'Overview of the VisHeart cardiac segmentation platform, AI analysis, 3D visualization, and target users.',
    keywords: ['introduction', 'visheart', 'ai-powered analysis', '3d visualization', 'fast processing'],
  },
  {
    tab: 'getting-started',
    title: 'Getting Started with VisHeart',
    excerpt: 'Create an account, upload NIfTI files, run segmentation, and review your results.',
    keywords: ['getting started', 'quick start', 'create account', 'upload medical images', 'run segmentation', 'nifti'],
  },
  {
    tab: 'accounts',
    title: 'Account Types',
    excerpt: 'Compare guest and registered user accounts, storage behavior, uploads, and project management.',
    keywords: ['accounts', 'guest account', 'user account', 'feature comparison', 'cloud storage', 'project management'],
  },
  {
    tab: 'how-it-works',
    title: 'How the Segmentation System Works',
    excerpt: 'Learn the segmentation workflow, MRI viewer, manual editing, masks, and project overview.',
    keywords: ['segmentation', 'mri viewer', 'segmentation viewer', 'manual editing', 'upload', 'workflow'],
  },
  {
    tab: 'reconstruction',
    title: '3D/4D Reconstruction',
    excerpt: 'Run 3D and 4D reconstructions, configure parameters, inspect results, and download outputs.',
    keywords: ['reconstruction', '3d', '4d', 'reference frame', 'download results', 'gpu inference'],
  },
];

const faqs = [
  {
    question: 'What file format is supported?',
    answer: 'The system supports NIfTI files, including .nii and .nii.gz.',
  },
  {
    question: 'What does segmentation do?',
    answer: 'Segmentation identifies cardiac structures from MRI images and prepares masks for review or reconstruction.',
  },
  {
    question: 'How do I start?',
    answer: 'Create a project, upload an MRI file, select a model, and run segmentation.',
  },
  {
    question: 'Who receives FAQ messages?',
    answer: 'FAQ messages are sent to the configured admin support email for this Docker deployment.',
  },
];

router.get('/docs/search', (req: Request, res: Response): void => {
  const query = String(req.query.q ?? '').trim().toLowerCase();
  const results = docs
    .map((item) => {
      const haystack = [item.title, item.excerpt, ...item.keywords].join(' ').toLowerCase();
      const score = !query
        ? 1
        : item.title.toLowerCase().includes(query)
          ? 3
          : haystack.includes(query)
            ? 1
            : 0;
      return { ...item, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .map(({ score, ...item }) => item);

  res.status(200).json({ success: true, results });
});

router.get('/faq', (_req: Request, res: Response): void => {
  res.status(200).json({ success: true, faqs });
});

router.post('/faq-message', async (req: Request, res: Response): Promise<void> => {
  const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
  const senderEmail = typeof req.body?.senderEmail === 'string' ? req.body.senderEmail.trim() : '';
  const senderName = typeof req.body?.senderName === 'string' ? req.body.senderName.trim() : '';

  if (message.length < 5) {
    res.status(400).json({ success: false, message: 'Please enter a question before sending.' });
    return;
  }

  try {
    const adminEmail = await resolveAdminEmail();
    const delivery = await sendFaqEmail({
      to: adminEmail,
      from: process.env.SMTP_FROM?.trim() || process.env.ADMIN_SUPPORT_EMAIL?.trim() || adminEmail,
      replyTo: senderEmail,
      senderName,
      message,
    });

    logger.info(`${serviceLocation}: FAQ message for ${adminEmail}`, {
      senderEmail: senderEmail || 'anonymous',
      senderName: senderName || 'anonymous',
      delivery,
    });

    res.status(200).json({
      success: true,
      message: delivery === 'email'
        ? `FAQ message sent to ${adminEmail}.`
        : `FAQ message saved for ${adminEmail}. Configure SMTP_HOST to send it as email.`,
      adminEmail,
      delivery,
    });
  } catch (error) {
    logger.error(`${serviceLocation}: Failed to send FAQ message`, error);
    res.status(500).json({ success: false, message: 'Could not send your FAQ message. Please try again.' });
  }
});

async function resolveAdminEmail(): Promise<string> {
  const supportEmail = process.env.ADMIN_SUPPORT_EMAIL?.trim();
  const adminEmail = process.env.ADMIN_EMAIL?.trim();
  if (supportEmail) return supportEmail;
  if (adminEmail) return adminEmail;

  const admin = await userModel.findOne({ role: UserRole.Admin }).sort({ createdAt: 1 }).lean();
  return admin?.email || 'meiqiliew334@gmail.com';
}

async function sendFaqEmail({
  to,
  from,
  replyTo,
  senderName,
  message,
}: {
  to: string;
  from: string;
  replyTo?: string;
  senderName?: string;
  message: string;
}): Promise<'email' | 'logged'> {
  const host = process.env.SMTP_HOST?.trim();
  if (!host) {
    logger.warn(`${serviceLocation}: SMTP_HOST is not configured; FAQ message logged only.`, {
      to,
      replyTo: replyTo || 'anonymous',
      senderName: senderName || 'anonymous',
      message,
    });
    return 'logged';
  }

  const port = Number(process.env.SMTP_PORT || '465');
  const secure = process.env.SMTP_SECURE !== 'false';
  const username = process.env.SMTP_USER?.trim();
  const password = process.env.SMTP_PASS?.replace(/\s+/g, '');
  const socket = secure
    ? tls.connect({ host, port, servername: host })
    : net.connect({ host, port });

  await waitForReady(socket);
  await readSmtpResponse(socket);
  await smtpCommand(socket, `EHLO ${process.env.SMTP_EHLO_HOST || 'visheart.local'}`);

  if (username && password) {
    await smtpCommand(socket, 'AUTH LOGIN');
    await smtpCommand(socket, Buffer.from(username).toString('base64'));
    await smtpCommand(socket, Buffer.from(password).toString('base64'));
  }

  await smtpCommand(socket, `MAIL FROM:<${from}>`);
  await smtpCommand(socket, `RCPT TO:<${to}>`);
  await smtpCommand(socket, 'DATA');

  const subject = 'VisHeart FAQ Message';
  const body = [
    `From: VisHeart Support <${from}>`,
    `To: ${to}`,
    replyTo ? `Reply-To: ${replyTo}` : '',
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    '',
    `Sender name: ${senderName || 'Anonymous'}`,
    `Sender email: ${replyTo || 'Anonymous'}`,
    '',
    message.replace(/\r?\n\./g, '\n..'),
    '.',
  ].filter(Boolean).join('\r\n');

  await smtpCommand(socket, body);
  await smtpCommand(socket, 'QUIT');
  socket.end();
  return 'email';
}

function waitForReady(socket: net.Socket | tls.TLSSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => socket.off('error', reject);
    socket.once('error', reject);
    if (socket instanceof tls.TLSSocket) {
      socket.once('secureConnect', () => {
        cleanup();
        resolve();
      });
      return;
    }
    socket.once('connect', () => {
      cleanup();
      resolve();
    });
  });
}

function readSmtpResponse(socket: net.Socket | tls.TLSSocket): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    const onData = (chunk: Buffer) => {
      data += chunk.toString('utf8');
      const lines = data.trimEnd().split(/\r?\n/);
      const lastLine = lines[lines.length - 1] || '';
      if (/^\d{3} /.test(lastLine)) {
        socket.off('data', onData);
        socket.off('error', reject);
        if (/^[45]\d{2}/.test(lastLine)) {
          reject(new Error(lastLine));
        } else {
          resolve(data);
        }
      }
    };
    socket.on('data', onData);
    socket.once('error', reject);
  });
}

async function smtpCommand(socket: net.Socket | tls.TLSSocket, command: string): Promise<string> {
  socket.write(`${command}\r\n`);
  return readSmtpResponse(socket);
}

export default router;
