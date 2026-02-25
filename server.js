import 'dotenv/config';
import app from './app.js';
import { assertDb } from './lib/db.js';

const PORT = process.env.PORT || 5000;

app.listen(PORT, async () => {
  await assertDb();
  console.log(`Server is running on port ${PORT}`);
});
