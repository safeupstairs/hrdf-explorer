# Node 22 is required (Next 16 ≥20.9; better-sqlite3@13 ≥22).
FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && useradd -m -u 1000 user \
  && mkdir -p /data \
  && chmod 777 /data

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci \
  && apt-get purge -y python3 make g++ \
  && apt-get autoremove -y \
  && rm -rf /var/lib/apt/lists/*

COPY --chown=user:user . .
RUN chmod +x docker-entrypoint.sh

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
RUN npm run build && chown -R user:user /app

ENV HRDF_DB=/data/hrdf.sqlite
ENV HRDF_ZIP=/data/hrdf.zip
ENV HOSTNAME=0.0.0.0
ENV PORT=8080

USER user
EXPOSE 8080 7860
ENTRYPOINT ["./docker-entrypoint.sh"]
