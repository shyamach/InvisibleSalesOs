import { processLeadThroughCognitiveEngine } from '../engine.js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

// -------------------------------------------------------------------
// 1. THE SECURITY HANDSHAKE (GET)
// Meta uses this to verify you actually own the webhook endpoint.
// -------------------------------------------------------------------
export const verifyWhatsAppWebhook = (req, res) => {
    const verify_token = process.env.META_WEBHOOK_VERIFY_TOKEN || process.env.WHATSAPP_VERIFY_TOKEN;
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    console.log(`\n🔒 [Meta Security Watchdog]: Handshake request intercepted from Facebook Cloud.`);

    if (mode && token) {
        if (mode === "subscribe" && token === verify_token) {
            console.log("✅ [Security Verified]: Webhook binding successfully authenticated with Meta.");
            return res.status(200).send(challenge);
        } else {
            console.error("❌ [Security Breach]: Webhook handshake failed. Token mismatch.");
            return res.sendStatus(403);
        }
    }
    return res.sendStatus(400);
};

// -------------------------------------------------------------------
// 2. THE DATA INGESTION STREAM (POST)
// Receives live text messages from users on their mobile phones.
// -------------------------------------------------------------------
export const processWhatsAppWebhook = async (req, res) => {
    // Meta requires a 200 OK immediately, or they will retry sending the message.
    res.sendStatus(200);

    const body = req.body;

    try {
        // Validate it is a WhatsApp API status update or message
        if (body.object !== "whatsapp_business_account") return;
        
        const entry = body.entry?.[0];
        const changes = entry?.changes?.[0]?.value;
        
        // Isolate actual user messages (ignore delivery receipts and status updates)
        if (changes?.messages && changes.messages.length > 0) {
            const messageObj = changes.messages[0];
            const contactObj = changes.contacts?.[0];
            
            const rawSenderPhone = messageObj.from; // User's phone number
            const senderName = contactObj?.profile?.name || "Unknown Prospect";
            
            let messageText = "";

            // Extract the text depending on message type
            if (messageObj.type === "text") {
                messageText = messageObj.text.body;
            } else if (messageObj.type === "button") {
                messageText = messageObj.button.text;
            } else if (messageObj.type === "interactive") {
                messageText = messageObj.interactive.button_reply?.title || messageObj.interactive.list_reply?.title;
            } else {
                console.warn(`⚠️ [WhatsApp Ingest]: Unsupported message type received: [${messageObj.type}]`);
                return;
            }

            console.log(`\n📱 [Live WhatsApp Intercept]: Stream from +${rawSenderPhone}`);
            console.log(`💬 Message Payload: "${messageText}"`);

            // Compile the data for the Cognitive Brain
            const compiledPayload = `
                [SOURCE CHANNEL: WHATSAPP]
                [SENDER NAME: ${senderName}]
                [SENDER PHONE: +${rawSenderPhone}]
                [MESSAGE]: ${messageText}
            `;

            // Hand off to the master engine core (Target Brand ID 1)
            const engineResult = await processLeadThroughCognitiveEngine(
                compiledPayload, 'text', 'whatsapp-inbound-stream', 1
            );

            if (!engineResult.success) {
                console.error("❌ [WhatsApp Handoff Error]: Engine execution failed.", engineResult.error);
            }
        }
    } catch (error) {
        console.error("🚨 [WhatsApp Processing Fatal Error]:", error);
    }
};