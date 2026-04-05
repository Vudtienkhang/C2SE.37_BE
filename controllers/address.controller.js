import prisma from '../prisma/prisma.js';

export const getAddresses = async (req, res) => {
  try {
    const { userId } = req.params;
    
    // Find customer id associated with user
    const customer = await prisma.customer.findUnique({
      where: { userId: parseInt(userId, 10) }
    });

    if (!customer) {
      return res.status(200).json({ data: [] });
    }

    const addresses = await prisma.savedAddress.findMany({
      where: { customerId: customer.id },
      orderBy: { id: 'asc' }
    });

    res.status(200).json({ data: addresses });
  } catch (error) {
    console.error("Error getting addresses:", error);
    res.status(500).json({ message: "Internal server error", error: error.message });
  }
};

export const addAddress = async (req, res) => {
  try {
    const { userId } = req.params;
    const { type, name, address, lat, lng } = req.body;

    let customer = await prisma.customer.findUnique({
      where: { userId: parseInt(userId, 10) }
    });

    if (!customer) {
      customer = await prisma.customer.create({
        data: {
          userId: parseInt(userId, 10)
        }
      });
    }

    const newAddress = await prisma.savedAddress.create({
      data: {
        customerId: customer.id,
        type,
        name,
        address,
        lat: lat != null ? Number(lat) : null,
        lng: lng != null ? Number(lng) : null
      }
    });

    res.status(201).json({ data: newAddress, message: "Address saved successfully" });
  } catch (error) {
    console.error("Error saving address:", error);
    res.status(500).json({ message: "Internal server error", error: error.message });
  }
};

export const deleteAddress = async (req, res) => {
  try {
    const { addressId } = req.params;

    await prisma.savedAddress.delete({
      where: { id: parseInt(addressId, 10) }
    });

    res.status(200).json({ message: "Address deleted successfully" });
  } catch (error) {
    console.error("Error deleting address:", error);
    res.status(500).json({ message: "Internal server error", error: error.message });
  }
};

export const updateAddress = async (req, res) => {
  try {
    const { addressId } = req.params;
    const { type, name, address, lat, lng } = req.body;

    const updatedAddress = await prisma.savedAddress.update({
      where: { id: parseInt(addressId, 10) },
      data: {
        type,
        name,
        address,
        lat: lat != null ? Number(lat) : null,
        lng: lng != null ? Number(lng) : null
      }
    });

    res.status(200).json({ data: updatedAddress, message: "Address updated successfully" });
  } catch (error) {
    console.error("Error updating address:", error);
    res.status(500).json({ message: "Internal server error", error: error.message });
  }
};
