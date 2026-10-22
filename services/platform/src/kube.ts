import { readFile } from "node:fs/promises";
import { Agent, fetch } from "undici";
export class KubeError extends Error {
  constructor(public status: number) {
    super("Kubernetes request returned HTTP " + status);
  }
}
export const resourcePlural: Record<string, string> = {
  Namespace: "namespaces",
  ResourceQuota: "resourcequotas",
  LimitRange: "limitranges",
  NetworkPolicy: "networkpolicies",
  Secret: "secrets",
  PersistentVolumeClaim: "persistentvolumeclaims",
  Deployment: "deployments",
  Service: "services",
  Job: "jobs",
  Ingress: "ingresses",
  Certificate: "certificates",
  Middleware: "middlewares",
  RoleBinding: "rolebindings",
};
export function resourcePath(o: any) {
  const root = o.apiVersion === "v1" ? "/api/v1" : "/apis/" + o.apiVersion;
  return (
    root +
    (o.kind === "Namespace" ? "" : "/namespaces/" + o.metadata.namespace) +
    "/" +
    resourcePlural[o.kind] +
    "/" +
    o.metadata.name
  );
}
export class Kube {
  private agent?: Agent;
  constructor(
    private base = process.env.KUBE_API_URL ??
      `https://${process.env.KUBERNETES_SERVICE_HOST}:${process.env.KUBERNETES_SERVICE_PORT_HTTPS ?? 443}`,
    private tokenPath = "/var/run/secrets/kubernetes.io/serviceaccount/token",
    private caPath = "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt",
  ) {}
  async request(
    path: string,
    method = "GET",
    body?: unknown,
    apply = false,
  ): Promise<any> {
    if (!this.agent)
      this.agent = new Agent({
        connect: { ca: await readFile(this.caPath), timeout: 8000 },
      });
    const token = (await readFile(this.tokenPath, "utf8")).trim();
    const r = await fetch(this.base + path, {
      method,
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": apply
          ? "application/apply-patch+yaml"
          : "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      dispatcher: this.agent,
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) {
      await r.body?.cancel();
      throw new KubeError(r.status);
    }
    return r.status === 204 ? {} : r.json();
  }
  async get(path: string) {
    try {
      return await this.request(path);
    } catch (e) {
      if (e instanceof KubeError && e.status === 404) return null;
      throw e;
    }
  }
  async create(o: any) {
    return this.request(
      resourcePath(o).split("/").slice(0, -1).join("/"),
      "POST",
      o,
    );
  }
  async apply(o: any) {
    return this.request(
      resourcePath(o) + "?fieldManager=urumi-store-provisioner&force=true",
      "PATCH",
      o,
      true,
    );
  }
  async delete(path: string) {
    try {
      return await this.request(path, "DELETE", {
        apiVersion: "v1",
        kind: "DeleteOptions",
        propagationPolicy: "Foreground",
      });
    } catch (e) {
      if (e instanceof KubeError && e.status === 404) return null;
      throw e;
    }
  }
  async close() {
    await this.agent?.close();
  }
}
