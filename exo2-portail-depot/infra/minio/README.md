# Policy applicative MinIO

`app-policy.json` est un **gabarit** : `__BUCKET__` est remplacé par la valeur de `STORAGE_BUCKET`
avant d'être poussé. Il est lu à deux endroits, et c'est voulu — une permission accordée ici est
forcément exercée par les tests :

- le conteneur `minio-init` du compose, qui l'enregistre sous le nom `portail-app` ;
- `backend/test/storage.int-spec.ts`, qui l'applique au MinIO éphémère de la suite d'intégration.

## Les deux portées d'ARN

L'ARN doit désigner **ce sur quoi l'opération agit**, pas ce qu'elle renvoie.

| ARN | Opérations |
|---|---|
| `arn:aws:s3:::<bucket>` | `HeadBucket`, `ListObjectsV2`, `GetBucketLocation` |
| `arn:aws:s3:::<bucket>/*` | `GetObject`, `PutObject`, `DeleteObject` |

`s3:ListBucket` est le piège : l'appel SDK s'appelle `ListObjectsV2`, ce qui pousse à le ranger du
côté des objets, mais il interroge le *bucket* pour qu'il énumère son contenu. Placé sur `/*` il
n'est jamais trouvé, et MinIO répond `AccessDenied` **sans dire quelle permission manque** — il ne
renseigne délibérément pas sur la policy en place. Symptôme : `deleteByPrefix` échoue alors que lire
et écrire fonctionnent.

## Pourquoi ces actions

`s3:AbortMultipartUpload` et `s3:ListMultipartUploadParts` ne sont pas décoratifs : `Upload`
(`@aws-sdk/lib-storage`) bascule en multipart au-delà de 5 Mo, et `s3:PutObject` seul ne suffit plus.
Leur absence ne casserait que les gros fichiers.

## Ce qui ne doit pas y entrer

Ni `s3:CreateBucket`, ni `s3:DeleteBucket`, ni aucune action `admin:`. Le provisionnement est le
travail de `minio-init`, avec les identifiants root ; l'application ne fait que constater que son
bucket existe. Ajouter l'une de ces actions annulerait tout l'intérêt de cette policy.
