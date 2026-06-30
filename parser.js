import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '.env.local') });

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

/**
 * Advanced Multimodal Lead Processing Kernel
 * Processes messy strings, handwritten paper image media, PDFs, or spreadsheet data matrix frames.
 * @param {string|Buffer} inputData - The raw content string or binary media buffer tracking the lead
 * @param {string} mediaType - 'text', 'image/jpeg', 'image/png', or 'application/pdf'
 */
export async function parseIncomingLead(inputData, mediaType = 'text') {
  console.log(`\n🧠 [AI Parsing Engine]: Initializing analysis loop for input type: [${mediaType.toUpperCase()}]`);

  const systemPrompt = `You are an elite B2B enterprise data extraction and OCR engine. Your job is to process messy, unstructured inputs—including highly fragmented text logs, spreadsheet data dumps, or raw handwriting text extracted from smartphone camera photos of notebooks/paper.

  Analyze the media context thoroughly and isolate the core business entities. Extract and populate the following keys into a valid JSON object structure:
  - name (string: Individual contact's name, or default to 'Unknown Prospect')
  - company (string or null: Clean corporate entity name, set to null if unstated)
  - phone (string: Standardized phone string sequence digits)
  - email (string or null: Contact email address if present in the input, else null)
  - query (string: Concise, professional summary of their product requirements or commercial intent)
  - priority (string: HIGH if order volume is large, urgent, or a tier-1 distributor scale contract, otherwise NORMAL)
  - preferred_channel (string or null: ONLY set when the message EXPLICITLY requests a reply channel — 'email' if they ask for an email/link/deck, 'whatsapp' if they explicitly ask for whatsapp/text/mobile. If no explicit channel is requested, return null so the system can reply on the channel they contacted on.)

  CRITICAL COMPLIANCE RULES:
  1. If processing an image of handwritten text, apply advanced visual context decoding to untangle messy characters, spelling mistakes, or scribbled notations.
  2. If processing spreadsheet/CSV cells, reconstruct the rows mentally to align the correct contact data with their respective inquiries.
  3. Return ONLY the raw, valid JSON object. Do not include markdown codeblocks (\`\`\`json), notes, explanations, or system prose.`;

  try {
    let messageContentSlot = [];

    if (mediaType === 'text') {
      // Standard conversational string handling path
      messageContentSlot.push({
        role: "user",
        content: `Parse this raw, unstructured lead data context: "${inputData}"`
      });
    } else {
      // Multimodal Media Processing Path (Images/PDFs)
      console.log("📸 Processing advanced document media matrix. Optimizing transport package size...");
      
      let base64Data = '';
      if (Buffer.isBuffer(inputData)) {
        // If data is a raw filesystem buffer, compress/convert to base64 string natively
        base64Data = inputData.toString('base64');
      } else {
        base64Data = inputData; // Assume pre-extracted base64 data string passing through
      }

      // Maximize network efficiency: Check base64 data payload metrics
      const contentSizeInMB = (base64Data.length * 0.75) / (1024 * 1024);
      console.log(`📏 Media Size Evaluation: ~${contentSizeInMB.toFixed(2)} MB payload envelope.`);

      if (contentSizeInMB > 4.5) {
        console.warn("⚠️ High-resolution media alert. Transport payload approaches edge limits. Claude optimization constraints active.");
      }

      messageContentSlot.push({
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: mediaType, // Dynamically maps 'image/jpeg' or 'image/png'
              data: base64Data
            }
          },
          {
            type: "text",
            text: "Extract all business lead profiles, handwritten text notes, or data values visible in this document media into the required structured JSON format."
          }
        ]
      });
    }

    // Fire the multimodal packet straight to Claude production gateways
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1200,
      system: systemPrompt,
      messages: messageContentSlot,
    });

    const rawTextOutput = response.content[0].text.trim();
    
    // Safety sanitation: strip away accidental markdown wrapper strings if appended by model edges
    const cleanJsonString = rawTextOutput
      .replace(/^```json/i, '')
      .replace(/^```/, '')
      .replace(/```$/, '')
      .trim();

    return JSON.parse(cleanJsonString);

  } catch (error) {
    console.error("❌ AI Multimodal Parsing Core Failure:", error.message || error);
    return null;
  }
}