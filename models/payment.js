import mongoose from 'mongoose';

const { Schema } = mongoose;

const PaymentSchema = new Schema({
  user_id: {
    type: String,
    required: true,
  },
  username: {
    type: String,
    required: true,
  },
  amount: {
    type: String,
    required: true,
  },
  payment_date: {
    type: String, // Store the formatted date as a string
    required: true,
  },
});

const Payment = mongoose.model('Payment', PaymentSchema);

export default Payment;
