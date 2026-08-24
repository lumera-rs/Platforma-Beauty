import { Router, type IRouter } from "express";
import healthRouter from "./health";
import imageMediaRouter from "./image-media";
import mediaRouter from "./media";
import marketplaceRouter from "./marketplace";
import growthRouter from "./growth";
import providerWebhooksRouter from "./provider-webhooks";
import phase3Router from "./phase3";
import widgetRouter from "./widget";
import businessGuideRouter from "./business-guide";
import beautyJobsRouter from "./beauty-jobs";

const router: IRouter = Router();

router.use(healthRouter);
router.use(businessGuideRouter);
router.use(beautyJobsRouter);
router.use(imageMediaRouter);
router.use(mediaRouter);
router.use(widgetRouter);
router.use(phase3Router);
router.use(marketplaceRouter);
router.use(growthRouter);
router.use(providerWebhooksRouter);

export default router;
