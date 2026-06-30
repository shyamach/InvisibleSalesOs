import { processLeadThroughCognitiveEngine } from '../engine.js';

/**
 * Omnichannel Autonomous Ingestion Gateway
 * Routes incoming text and multi-format webhooks straight to the central cognitive brain
 */
export async function handleAutomatedIngest(req, res) {
  const sourceChannel = req.headers['x-source-channel'] || req.query.source || 'global-webhook';
  
  let rawPayload = '';
  let inputFormat = 'text';

  try {
    // 1. Dynamic Payload Ingestion Validation
    if (req.body) {
      if (req.body.rawText) {
        rawPayload = req.body.rawText;
        inputFormat = 'text';
      } else if (req.body.imageBuffer || req.body.imageBase64) {
        rawPayload = req.body.imageBuffer || req.body.imageBase64;
        inputFormat = req.body.mimeType || 'image/jpeg';
      } else {
        rawPayload = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
        inputFormat = 'text';
      }
    }

    if (!rawPayload || rawPayload === '{}') {
      return res.status(400).json({ success: false, error: "Ingestion Aborted: Payload payload stream empty." });
    }

    // 2. Direct Inbound Handoff straight to our new Unified Cognitive Brain Engine
    // Default brand configuration ID maps to 1 for our sandboxed local environment testing
    const engineResult = await processLeadThroughCognitiveEngine(rawPayload, inputFormat, sourceChannel, 1);

    if (!engineResult.success) {
      return res.status(500).json({ success: false, error: "Engine execution failure.", details: engineResult.error });
    }

    // 3. Return telemetry — engine now returns leadId and profile directly
    return res.status(202).json({
      success: true,
      message: "Payload cleanly routed through Brand DNA rules and active 2-way response armed.",
      trackingId: engineResult.leadId ?? null,
      classification: engineResult.profile?.priority ?? null,
      score: engineResult.profile?.qualification_score ?? null,
      routeSelected: engineResult.profile?.preferred_channel ?? null,
      delivery: engineResult.deliveryStatus ?? null,
    });

  } catch (error) {
    console.error(`🚨 Ingestion Gate Failure:`, error);
    return res.status(500).json({ success: false, error: error.message || error });
  }
}