const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: process.env.SMTP_PORT || 587,
  secure: false,

  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// Verify SMTP connection
transporter.verify((error, success) => {
  if (error) {
    console.log('❌ SMTP Error:', error.message);
  } else {
    console.log('✅ SMTP Server Ready');
  }
});

const sendEmail = async (to, subject, html) => {
  try {
    const info = await transporter.sendMail({
      from: process.env.EMAIL_FROM,
      to,
      subject,
      html,
    });

    console.log('📧 Email Sent:', info.messageId);

    return info;
  } catch (error) {
    console.error('❌ Email Send Failed:', error.message);
    throw error;
  }
};

module.exports = sendEmail;
