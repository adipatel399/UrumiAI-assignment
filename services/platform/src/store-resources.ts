import { randomBytes } from "node:crypto";
import type { ManagedStore } from "./stores.js";
export const managedBy = "urumi-store-provisioner";
export const labels = (s: ManagedStore) => ({
  "app.kubernetes.io/managed-by": managedBy,
  "urumi.io/store-id": s.id,
  "urumi.io/platform": s.spec.STORE_GATEWAY_NAMESPACE,
});
export function freshStoreSecret() {
  return {
    "db-password": randomBytes(32).toString("base64url"),
    "db-root-password": randomBytes(32).toString("base64url"),
    WP_ADMIN_USER: "storeadmin",
    WP_ADMIN_PASSWORD: randomBytes(24).toString("base64url"),
    WP_ADMIN_EMAIL: "storeadmin@example.test",
    WOO_CONSUMER_KEY: "ck_" + randomBytes(20).toString("hex"),
    WOO_CONSUMER_SECRET: "cs_" + randomBytes(20).toString("hex"),
    MCP_BEARER_TOKEN: randomBytes(48).toString("base64url"),
    SERVICE_USER_PASSWORD: randomBytes(32).toString("base64url"),
  };
}
export function storeResources(s: ManagedStore) {
  const spec = s.spec,
    ns = s.namespace,
    host = new URL(s.url).hostname;
  const resources: any[] = [];
  const obj = (apiVersion: string, kind: string, name: string, body: any) => ({
    apiVersion,
    kind,
    metadata: { name, namespace: ns, labels: labels(s) },
    ...body,
  });
  const policy = (name: string, podSelector: any, types: string[], rest: any) =>
    obj("networking.k8s.io/v1", "NetworkPolicy", name, {
      spec: { podSelector, policyTypes: types, ...rest },
    });
  const peer = (app: string) => ({ podSelector: { matchLabels: { app } } });
  const corePeer = (app: string) => ({
    namespaceSelector: {
      matchLabels: {
        "kubernetes.io/metadata.name": spec.STORE_GATEWAY_NAMESPACE,
      },
    },
    podSelector: { matchLabels: { app } },
  });
  const port = (n: number) => ({ protocol: "TCP", port: n });
  resources.push(
    obj("v1", "ResourceQuota", "store-budget", {
      spec: {
        hard: {
          "requests.cpu": "1",
          "requests.memory": "1Gi",
          "limits.cpu": "4",
          "limits.memory": "3Gi",
          "requests.storage": "4Gi",
          pods: "6",
          persistentvolumeclaims: "2",
          secrets: "6",
        },
      },
    }),
    obj("v1", "LimitRange", "container-defaults", {
      spec: {
        limits: [
          {
            type: "Container",
            default: { cpu: "500m", memory: "256Mi" },
            defaultRequest: { cpu: "50m", memory: "64Mi" },
            max: { cpu: "1", memory: "1Gi" },
            min: { cpu: "10m", memory: "16Mi" },
          },
        ],
      },
    }),
  );
  resources.push(
    policy("default-deny", {}, ["Ingress", "Egress"], {}),
    policy("dns", {}, ["Egress"], {
      egress: [
        {
          to: [
            {
              namespaceSelector: {
                matchLabels: { "kubernetes.io/metadata.name": "kube-system" },
              },
              podSelector: { matchLabels: { "k8s-app": "kube-dns" } },
            },
          ],
          ports: [{ protocol: "UDP", port: 53 }, port(53)],
        },
      ],
    }),
  );
  const ingressProxy = {
    namespaceSelector: {
      matchLabels: { "kubernetes.io/metadata.name": "kube-system" },
    },
    podSelector: { matchLabels: { "app.kubernetes.io/name": "traefik" } },
  };
  resources.push(
    policy("store", { matchLabels: { app: "store" } }, ["Ingress", "Egress"], {
      ingress: [{ from: [ingressProxy, peer("mcp")], ports: [port(80)] }],
      egress: [{ to: [peer("database")], ports: [port(3306)] }],
    }),
    policy("database", { matchLabels: { app: "database" } }, ["Ingress"], {
      ingress: [
        { from: [peer("store"), peer("bootstrap")], ports: [port(3306)] },
      ],
    }),
    policy("bootstrap", { matchLabels: { app: "bootstrap" } }, ["Egress"], {
      egress: [{ to: [peer("database")], ports: [port(3306)] }],
    }),
    policy("mcp", { matchLabels: { app: "mcp" } }, ["Ingress", "Egress"], {
      ingress: [
        {
          from: [corePeer(spec.STORE_PLATFORM_RELEASE + "-gateway")],
          ports: [port(3000)],
        },
      ],
      egress: [{ to: [peer("store")], ports: [port(80)] }],
    }),
  );
  if (spec.STORE_TLS_ISSUER)
    resources.push(
      policy(
        "acme-solver",
        { matchLabels: { "acme.cert-manager.io/http01-solver": "true" } },
        ["Ingress"],
        { ingress: [{ from: [ingressProxy], ports: [port(8089)] }] },
      ),
    );
  for (const name of ["database", "content"])
    resources.push(
      obj("v1", "PersistentVolumeClaim", name, {
        spec: {
          accessModes: ["ReadWriteOnce"],
          storageClassName: spec.STORE_STORAGE_CLASS,
          resources: { requests: { storage: "2Gi" } },
        },
      }),
    );
  const env = (name: string, value: string) => ({ name, value }),
    secret = (name: string, key = name) => ({
      name,
      valueFrom: { secretKeyRef: { name: "store-credentials", key } },
    });
  const wpEnv = [
    env("WORDPRESS_DB_HOST", "database"),
    env("WORDPRESS_DB_NAME", "wordpress"),
    env("WORDPRESS_DB_USER", "wordpress"),
    secret("WORDPRESS_DB_PASSWORD", "db-password"),
    env("STORE_URL", s.url),
    env("MANAGED_STORE_NAME", s.name),
    secret("WP_ADMIN_USER"),
    secret("WP_ADMIN_PASSWORD"),
    secret("WP_ADMIN_EMAIL"),
  ];
  const wpVolume = [
    { name: "content", persistentVolumeClaim: { claimName: "content" } },
  ];
  const wpMount = [{ name: "content", mountPath: "/var/www/html" }];
  const deploy = (
    name: string,
    image: string,
    container: any,
    extra: any = {},
  ) =>
    obj("apps/v1", "Deployment", name, {
      spec: {
        replicas: 1,
        strategy: { type: "Recreate" },
        selector: { matchLabels: { app: name } },
        template: {
          metadata: { labels: { ...labels(s), app: name } },
          spec: {
            automountServiceAccountToken: false,
            ...extra,
            containers: [
              { name, image, imagePullPolicy: "IfNotPresent", ...container },
            ],
          },
        },
      },
    });
  resources.push(
    deploy(
      "database",
      spec.STORE_DATABASE_IMAGE,
      {
        env: [
          env("MARIADB_DATABASE", "wordpress"),
          env("MARIADB_USER", "wordpress"),
          secret("MARIADB_PASSWORD", "db-password"),
          secret("MARIADB_ROOT_PASSWORD", "db-root-password"),
        ],
        ports: [{ containerPort: 3306, name: "mysql" }],
        resources: {
          requests: { cpu: "100m", memory: "256Mi" },
          limits: { cpu: "1", memory: "768Mi" },
        },
        startupProbe: {
          exec: {
            command: ["healthcheck.sh", "--connect", "--innodb_initialized"],
          },
          periodSeconds: 5,
          failureThreshold: 60,
        },
        readinessProbe: {
          exec: {
            command: ["healthcheck.sh", "--connect", "--innodb_initialized"],
          },
          periodSeconds: 10,
          timeoutSeconds: 5,
        },
        livenessProbe: {
          exec: { command: ["healthcheck.sh", "--connect"] },
          periodSeconds: 20,
          timeoutSeconds: 5,
        },
        volumeMounts: [{ name: "data", mountPath: "/var/lib/mysql" }],
      },
      {
        volumes: [
          { name: "data", persistentVolumeClaim: { claimName: "database" } },
        ],
      },
    ),
  );
  resources.push(
    deploy(
      "store",
      spec.STORE_WORDPRESS_IMAGE,
      {
        env: wpEnv,
        ports: [{ containerPort: 80, name: "http" }],
        resources: {
          requests: { cpu: "100m", memory: "256Mi" },
          limits: { cpu: "1", memory: "768Mi" },
        },
        startupProbe: {
          httpGet: { path: "/healthz.php", port: 80 },
          periodSeconds: 5,
          failureThreshold: 90,
        },
        readinessProbe: {
          httpGet: { path: "/readyz.php", port: 80 },
          periodSeconds: 10,
          timeoutSeconds: 5,
        },
        livenessProbe: {
          httpGet: { path: "/healthz.php", port: 80 },
          periodSeconds: 20,
          timeoutSeconds: 5,
        },
        volumeMounts: wpMount,
      },
      { volumes: wpVolume },
    ),
  );
  resources.push(
    deploy(
      "mcp",
      spec.STORE_MCP_IMAGE,
      {
        env: [
          env("WOO_BASE_URL", "http://store"),
          env("WOO_PUBLIC_URL", s.url),
          env("STORE_TIMEZONE", "Asia/Kolkata"),
          env(
            "ALLOWED_HOSTS",
            "mcp,mcp." + ns + ".svc.cluster.local,localhost,127.0.0.1",
          ),
          secret("WOO_CONSUMER_KEY"),
          secret("WOO_CONSUMER_SECRET"),
          secret("MCP_BEARER_TOKEN"),
        ],
        ports: [{ containerPort: 3000, name: "http" }],
        resources: {
          requests: { cpu: "50m", memory: "64Mi" },
          limits: { cpu: "500m", memory: "192Mi" },
        },
        securityContext: {
          allowPrivilegeEscalation: false,
          readOnlyRootFilesystem: true,
          capabilities: { drop: ["ALL"] },
        },
        startupProbe: {
          httpGet: { path: "/healthz", port: 3000 },
          periodSeconds: 5,
          failureThreshold: 90,
        },
        readinessProbe: {
          httpGet: { path: "/readyz", port: 3000 },
          periodSeconds: 10,
          timeoutSeconds: 5,
        },
        livenessProbe: {
          httpGet: { path: "/healthz", port: 3000 },
          periodSeconds: 20,
          timeoutSeconds: 5,
        },
      },
      {
        securityContext: {
          runAsNonRoot: true,
          runAsUser: 1000,
          runAsGroup: 1000,
          seccompProfile: { type: "RuntimeDefault" },
        },
      },
    ),
  );
  for (const [name, p] of [
    ["database", 3306],
    ["store", 80],
    ["mcp", 3000],
  ] as const)
    resources.push(
      obj("v1", "Service", name, {
        spec: {
          selector: { app: name },
          ports: [{ name: "service", port: p, targetPort: p }],
        },
      }),
    );
  resources.push(
    obj("batch/v1", "Job", "bootstrap-" + s.attempt, {
      spec: {
        backoffLimit: 1,
        activeDeadlineSeconds: 360,
        template: {
          metadata: { labels: { ...labels(s), app: "bootstrap" } },
          spec: {
            restartPolicy: "Never",
            automountServiceAccountToken: false,
            containers: [
              {
                name: "bootstrap",
                image: spec.STORE_WORDPRESS_IMAGE,
                imagePullPolicy: "IfNotPresent",
                command: ["bash", "/opt/urumi/managed-bootstrap.sh"],
                env: [
                  ...wpEnv,
                  secret("WOO_CONSUMER_KEY"),
                  secret("WOO_CONSUMER_SECRET"),
                  secret("SERVICE_USER_PASSWORD"),
                ],
                resources: {
                  requests: { cpu: "100m", memory: "128Mi" },
                  limits: { cpu: "500m", memory: "512Mi" },
                },
                volumeMounts: wpMount,
              },
            ],
            volumes: wpVolume,
          },
        },
      },
    }),
  );
  if (spec.STORE_TLS_ISSUER) {
    resources.push(
      obj("cert-manager.io/v1", "Certificate", "store-tls", {
        spec: {
          secretName: "store-tls",
          issuerRef: { name: spec.STORE_TLS_ISSUER, kind: "ClusterIssuer" },
          dnsNames: [host],
        },
      }),
      obj("traefik.io/v1alpha1", "Middleware", "https", {
        spec: { redirectScheme: { scheme: "https", permanent: true } },
      }),
    );
  }
  resources.push(
    obj("networking.k8s.io/v1", "Ingress", "store", {
      metadata: {
        name: "store",
        namespace: ns,
        labels: labels(s),
        ...(spec.STORE_TLS_ISSUER
          ? {
              annotations: {
                "traefik.ingress.kubernetes.io/router.middlewares":
                  ns + "-https@kubernetescrd",
              },
            }
          : {}),
      },
      spec: {
        ingressClassName: "traefik",
        ...(spec.STORE_TLS_ISSUER
          ? { tls: [{ hosts: [host], secretName: "store-tls" }] }
          : {}),
        rules: [
          {
            host,
            http: {
              paths: [
                {
                  path: "/",
                  pathType: "Prefix",
                  backend: { service: { name: "store", port: { number: 80 } } },
                },
              ],
            },
          },
        ],
      },
    }),
  );
  return resources;
}
