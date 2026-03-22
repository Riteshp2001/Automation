const { google } = require("googleapis");

function createGoogleAuth(env) {
  return new google.auth.JWT({
    email: env.clientEmail,
    key: env.privateKey,
    scopes: ["https://www.googleapis.com/auth/drive"],
    subject: env.GOOGLE_IMPERSONATED_USER_EMAIL || undefined
  });
}

async function createGoogleClients(env) {
  const auth = createGoogleAuth(env);
  await auth.authorize();

  return {
    auth,
    drive: google.drive({
      version: "v3",
      auth
    })
  };
}

module.exports = {
  createGoogleClients
};
