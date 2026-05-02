import express, { Request, Response } from 'express';
import net from 'net';
import tls from 'tls';
import logger from '../services/logger';

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

router.get('/docs/search', (req: Request, res: Response) => {
  const query = String(req.query.q ?? '').trim().toLowerCase();

  if (!query) {
    res.status(200).json({ success: true, results: [] });
    return;
  }

  const results = docs
    .map((item) => {
      const haystack = [item.title, item.excerpt, ...item.keywords].join(' ').toLowerCase();
      const score = haystack.includes(query)
        ? item.title.toLowerCase().includes(query)
          ? 2
          : 1
        : 0;

      return { ...item, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .map(({ score, ...item }) => item);

  res.status(200).json({ success: true, results });
});

router.post('/faq-message', async (req: Request, res: Response) => {
  const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
  const senderEmail = typeof req.body?.senderEmail === 'string' ? req.body.senderEmail.trim() : '';
  const adminEmail = process.env.ADMIN_SUPPORT_EMAIL || process.env.ADMIN_EMAIL || 'admin@example.com';

  if (message.length < 5) {
    res.status(400).json({ success: false, message: 'Please enter a question before sending.' });
    return;
  }

  try {
    const delivery = await sendFaqEmail({
      to: adminEmail,
      from: process.env.SMTP_FROM || adminEmail,
      replyTo: senderEmail,
      message,
    });

    logger.info(`${serviceLocation}: FAQ message for ${adminEmail}`, {
      senderEmail: senderEmail || 'anonymous',
      delivery,
    });

    res.status(200).json({
      success: true,
      message: delivery === 'email'
        ? `FAQ message sent to ${adminEmail}.`
        : `FAQ message saved for ${adminEmail}. Configure SMTP_HOST to send it as email.`,
      adminEmail,
    });
  } catch (error) {
    logger.error(`${serviceLocation}: Failed to send FAQ message`, error);
    res.status(500).json({ success: false, message: 'Could not send your FAQ message. Please try again.' });
  }
});

export default router;

async function sendFaqEmail({
  to,
  from,
  replyTo,
  message,
}: {
  to: string;
  from: string;
  replyTo?: string;
  message: string;
}): Promise<'email' | 'logged'> {
  const host = process.env.SMTP_HOST;

  if (!host) {
    logger.warn(`${serviceLocation}: SMTP_HOST is not configured; FAQ message logged only.`, {
      to,
      replyTo: replyTo || 'anonymous',
      message,
    });
    return 'logged';
  }

  const port = Number(process.env.SMTP_PORT || '465');
  const secure = process.env.SMTP_SECURE !== 'false';
  const username = process.env.SMTP_USER;
  const password = process.env.SMTP_PASS;
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
    `Sender: ${replyTo || 'Anonymous'}`,
    '',
    message,
    '.',
  ].filter(Boolean).join('\r\n');

  await smtpCommand(socket, body);
  await smtpCommand(socket, 'QUIT');
  socket.end();

  return 'email';
}

function waitForReady(socket: net.Socket | tls.TLSSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once('error', reject);
    socket.once('connect', () => resolve());
    if (socket instanceof tls.TLSSocket) {
      socket.once('secureConnect', () => resolve());
    }
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
