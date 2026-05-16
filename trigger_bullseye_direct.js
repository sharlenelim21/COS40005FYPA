const FormData = require('form-data');
const fs = require('fs');
const mongoose = require('mongoose');

const MONGO_URL = process.env.MONGODB_URI || 'mongodb://admin:P%40ssw0rd123%21@mongodb:27017/visheart?authSource=admin';
const GPU_URL = 'http://gpu:8001';
const JWT_SECRET = process.env.GPU_SERVER_AUTH_JWT_SECRET || 'dev-gpu-secret';
const maskId = '69fc07e595f567b1681ff172';
const niftiPath = '/tmp/test_bullseye.nii.gz';

async function run() {
  const axios = require('axios').default || require('axios');
  const jwt = require('jsonwebtoken');

  await mongoose.connect(MONGO_URL);
  console.log('Connected to MongoDB');

  const token = jwt.sign({ id: 'visheart-node', role: 'backend' }, JWT_SECRET, { expiresIn: '1h' });
  console.log('Generated JWT (first 40 chars):', token.slice(0, 40));

  const form = new FormData();
  form.append('file', fs.createReadStream(niftiPath), { filename: 'input.nii.gz', contentType: 'application/gzip' });

  console.log('Posting to GPU bullseye/analyze...');
  const resp = await axios.post(`${GPU_URL}/bullseye/analyze`, form, {
    headers: { ...form.getHeaders(), Authorization: `Bearer ${token}` },
    timeout: 120000
  });

  console.log('GPU response status:', resp.status);
  const data = resp.data;
  data.computed_at = new Date().toISOString();
  console.log('Bullseye stats:', JSON.stringify(data.stats));

  const result = await mongoose.connection.collection('segmentation masks').findOneAndUpdate(
    { _id: new mongoose.Types.ObjectId(maskId) },
    { $set: { bullseye: data } },
    { returnDocument: 'after' }
  );
  console.log('Update acknowledged, hasBullseye:', !!(result && result.bullseye));

  await mongoose.disconnect();
  console.log('Done');
  process.exit(0);
}

run().catch(err => { console.error('FATAL:', err.message); process.exit(1); });
