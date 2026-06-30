import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

/**
 * MOCK EMBEDDING GENERATOR
 * Generates a 1536-dimensional vector array. 
 * In production, we swap this with an API call to OpenAI or Voyage AI.
 */
function generateMockEmbedding() {
  return Array.from({ length: 1536 }, () => Math.random() * 2 - 1);
}

/**
 * THE INGESTION PIPELINE
 * Slices text, vectorizes it, and saves it to the pgvector vault.
 */
async function trainCompanyKnowledge(brandId, documentTitle, rawText) {
  console.log(`\n🧠 [Training Sequence Initiated]: Processing document "${documentTitle}" for Brand ID: ${brandId}`);
  
  // 1. Chunking: Split the massive text into smaller, readable paragraphs
  const chunks = rawText.split('\n\n').filter(chunk => chunk.trim().length > 10);
  console.log(`✂️  [Data Slicing]: Document chunked into ${chunks.length} semantic blocks.`);

  const client = await pool.connect();

  try {
    // 2. Vectorization & Storage Loop
    for (let i = 0; i < chunks.length; i++) {
      const chunkText = chunks[i].trim();
      
      // Generate the mathematical coordinates for this specific chunk
      const vectorArray = generateMockEmbedding();
      // Format it exactly how Postgres pgvector expects: '[0.1, 0.2, ...]'
      const vectorString = `[${vectorArray.join(',')}]`;

      // 3. Inject into the Supabase Vault
      await client.query(
        `INSERT INTO company_knowledge (brand_id, document_title, content_chunk, embedding)
         VALUES ($1, $2, $3, $4)`,
        [brandId, documentTitle, chunkText, vectorString]
      );

      console.log(`✅ [Vault Sync]: Chunk ${i + 1}/${chunks.length} embedded and saved to Supabase.`);
    }

    console.log(`🎉 [Training Complete]: "${documentTitle}" is now permanently locked into the AI's memory vault.\n`);

  } catch (error) {
    console.error(`🚨 [Training Failure]:`, error);
  } finally {
    client.release();
    // Close the connection pool so the terminal process exits cleanly
    await pool.end(); 
  }
}

// ==========================================
// EXECUTE THE PILOT TRAINING RUN
// ==========================================
const sampleTrainingData = `
Shipping Policies: Invisible Sales OS delivers all physical goods within 3-5 business days across the UK. Next-day delivery is available for orders placed before 2 PM.

Wholesale Minimums: For tier 1 supplements, the minimum wholesale order is 100 boxes. The bulk discount rate kicks in at 500 boxes, reducing the unit price by 15%.

Refund Policy: We offer a 30-day money-back guarantee on all software licenses. Physical goods must be returned unopened to qualify for a full refund.
`;

// Trigger the function (Brand ID 1, Document Title, and the Data)
trainCompanyKnowledge(1, 'Core Operations Manual v1', sampleTrainingData);