const { createWorker } = require('./node_modules/tesseract.js');
const path = require('path');

async function test() {
  console.log("Starting OCR test with local langPath...");
  try {
    const worker = await createWorker('eng+ind', 1, {
      langPath: path.join(__dirname, "node_modules", "tesseract.js", "dist"),
    });
    console.log("Worker created successfully!");
    await worker.terminate();
    console.log("Worker terminated!");
  } catch (err) {
    console.error("Error in test:", err);
  }
}

test();
