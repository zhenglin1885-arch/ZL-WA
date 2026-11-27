class ConvertEmptyStringsToNull {
  async handle({ request }, next) {
    if (Object.keys(request.body).length > 0) {
      const currentRequest = request;
      currentRequest.body = Object.assign(
        ...Object.keys(request.body).map(key => ({
          [key]: request.body[key] === '' ? null : request.body[key],
        })),
      );
    }

    await next();
  }
}

module.exports = ConvertEmptyStringsToNull;
