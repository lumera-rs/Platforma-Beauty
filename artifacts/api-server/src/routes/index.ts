import { Router, type IRouter } from "express";
import healthRouter from "./health";
import imageMediaRouter from "./image-media";
import mediaRouter from "./media";
import marketplaceRouter from "./marketplace";

const router: IRouter = Router();

router.use(healthRouter);
router.use(imageMediaRouter);
router.use(mediaRouter);
router.use(marketplaceRouter);

export default router;
