import { Router, Request, Response } from 'express';
import { AnalyticsEventSchema } from '../types/analytics';
import { analyticsService } from '../services/analyticsService';
import { logger } from '../utils/logger';

const router = Router();

/**
 * @api {post} /api/events/track Track an analytics event
 * @apiName TrackEvent
 * @apiGroup Analytics
 * 
 * @apiParam {String} eventName Name of the event
 * @apiParam {String} [userId] Unique user identifier
 * @apiParam {String} sessionId UUID for the entire user session
 * @apiParam {String} vibeSessionId UUID scoped to one analysis attempt
 * @apiParam {String} flowType vibe_check | color_analysis | ask_ai
 * @apiParam {String} [platform] web | mobile
 * @apiParam {Object} properties Event-specific metadata
 */
router.post('/track', async (req: Request, res: Response) => {
  try {
    const result = AnalyticsEventSchema.safeParse(req.body);

    if (!result.success) {
      logger.warn({ errors: result.error.format(), body: req.body }, 'Invalid analytics event received');
      return res.status(400).json({
        error: 'Invalid event data',
        details: result.error.format(),
      });
    }

    analyticsService.track(result.data);
    
    // We return 202 Accepted because the event is queued for batch processing
    return res.status(202).json({ status: 'queued' });
  } catch (error) {
    logger.error({ error }, 'Error tracking analytics event');
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
