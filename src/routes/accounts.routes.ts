import { Router } from "express";
import { listAccounts, getAccount, createAccount, updateAccount, deleteAccount, transferBetweenAccounts, listTransfers } from "../controllers/accounts.controller";

const router = Router();

router.get("/", listAccounts);
router.get("/transfers", listTransfers);
router.get("/:id", getAccount);
router.post("/", createAccount);
router.post("/transfer", transferBetweenAccounts);
router.put("/:id", updateAccount);
router.delete("/:id", deleteAccount);

export default router;
