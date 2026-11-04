// Builds terrain chunk vertex data off the main thread.
import { buildChunkData } from './chunkData.js';

self.onmessage = (e) => {
  const job = e.data;
  const data = buildChunkData(job.x0, job.z0, job.size, job.seg);
  self.postMessage({ id: job.id, ...data }, [data.positions.buffer, data.normals.buffer]);
};
