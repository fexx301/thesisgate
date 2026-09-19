FROM node:24-bookworm-slim

WORKDIR /app
COPY quota-service ./quota-service

ENV NODE_ENV=production
ENV THESIS_QUOTA_HOST=0.0.0.0
ENV THESIS_QUOTA_DATABASE_PATH=/data/quota.sqlite

VOLUME ["/data"]
EXPOSE 8787

CMD ["node", "--experimental-strip-types", "quota-service/server.ts"]
