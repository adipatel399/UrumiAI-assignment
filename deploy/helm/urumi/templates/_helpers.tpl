{{- define "urumi.storeEnvironment" -}}
- {name: STORES_ENABLED, value: {{ .Values.provisioning.enabled | quote }}}
- {name: STORE_BASE_DOMAIN, value: {{ .Values.provisioning.baseDomain | quote }}}
- {name: STORE_PUBLIC_SCHEME, value: {{ if .Values.tls.enabled }}"https"{{ else }}"http"{{ end }}}
- {name: STORE_PUBLIC_PORT, value: {{ .Values.provisioning.publicPort | quote }}}
- {name: STORE_PLATFORM_RELEASE, value: {{ .Release.Name | quote }}}
- {name: STORE_GATEWAY_NAMESPACE, value: {{ .Release.Namespace | quote }}}
- {name: STORE_WORDPRESS_IMAGE, value: {{ .Values.store.image | quote }}}
- {name: STORE_DATABASE_IMAGE, value: {{ .Values.database.image | quote }}}
- {name: STORE_MCP_IMAGE, value: {{ .Values.woocommerceMcp.image | quote }}}
- {name: STORE_STORAGE_CLASS, value: {{ .Values.provisioning.storageClass | quote }}}
- {name: STORE_TLS_ISSUER, value: {{ if .Values.tls.enabled }}"{{ .Release.Name }}-managed-stores-acme"{{ else }}""{{ end }}}
- {name: STORE_MAX_PER_USER, value: {{ .Values.provisioning.maxPerUser | quote }}}
- {name: STORE_MAX_TOTAL, value: {{ .Values.provisioning.maxTotal | quote }}}
- {name: STORE_PROVISION_TIMEOUT_SECONDS, value: {{ .Values.provisioning.timeoutSeconds | quote }}}
{{- end -}}
