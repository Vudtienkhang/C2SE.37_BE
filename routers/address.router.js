import express from 'express';
import { getAddresses, addAddress, deleteAddress, updateAddress } from '../controllers/address.controller.js';

const router = express.Router();

router.get('/:userId', getAddresses);
router.post('/:userId', addAddress);
router.put('/:addressId', updateAddress);
router.delete('/:addressId', deleteAddress);

export default router;
