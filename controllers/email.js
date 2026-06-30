import { processLeadThroughCognitiveEngine } from '../engine.js';

/**
 * INVISIBLE SALES OS - MODULE 2: INBOUND EMAIL WRAPPER
 */
export async function handleInboundEmailParse(req, res) {
  console.log(`\n📧 [Email Listener Active]: Intercepted inbound SMTP data stream.`);

  try {
    const senderData = req.body.from || req.body.sender || 'unknown-prospect@corporate.com';
    const subjectLine = req.body.subject || 'No Subject Provided';
    const emailBody = req.body.text || req.body.html || '';

    if (!emailBody) {
      console.warn("⚠️ [Email Wrapper]: Received empty payload from mail server. Dropping packet.");
      return res.status(400).send("Wrapper Aborted: No parseable text body found.");
    }

    console.log(`📨 Source Envelope: ${senderData}`);
    console.log(`🏷️ Subject Context: ${subjectLine}`);

    const compiledPayload = `
      [SOURCE CHANNEL: EMAIL]
      [SENDER IDENTITY: ${senderData}]
      [SUBJECT: ${subjectLine}]
      
      [BODY CONTENT]:
      ${emailBody}
    `;

    const engineResult = await processLeadThroughCognitiveEngine(
      compiledPayload, 'text', 'email-inbound-stream', 1 
    );

    if (!engineResult.success) {
      return res.status(500).send("Engine parsing failure.");
    }

    console.log(`✅ [Email Wrapper]: Successfully processed lead. Tracking ID: ${engineResult.leadId ?? 'n/a'}`);
    return res.status(200).json({ success: true, leadId: engineResult.leadId ?? null });

  } catch (error) {
    console.error(`🚨 [Email Ingestion Gate Failure]:`, error);
    return res.status(500).send("Internal wrapper routing error.");
  }
}