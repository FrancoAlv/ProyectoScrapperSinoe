// Module exports index
module.exports = {
  FormFieldManager: require('./FormFieldManager'),
  LoginValidator: require('./validation/LoginValidator'),
  SessionManager: require('./session/SessionManager'),
  NavigationManager: require('./navigation/NavigationManager'),
  DataExtractor: require('./extraction/DataExtractor'),
  WhatsAppManager: require('./whatsapp/WhatsAppManager'),
  EmailManager: require('./email/EmailManager'),
  S3SessionManager: require('./storage/S3SessionManager')
};