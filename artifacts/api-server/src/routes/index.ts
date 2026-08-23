import { Router, type IRouter } from "express";
import healthRouter from "./health";
import imageMediaRouter from "./image-media";
import mediaRouter from "./media";
import marketplaceRouter from "./marketplace";
import growthRouter from "./growth";
import providerWebhooksRouter from "./provider-webhooks";

const router: IRouter = Router();

router.use(healthRouter);
router.use(imageMediaRouter);
router.use(mediaRouter);
router.use(marketplaceRouter);
router.use(growthRouter);
router.use(providerWebhooksRouter);

export default router;
