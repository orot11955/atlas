// Compatibility exports: driver normalization now lives in the base implementation.
// Keeping the old public name avoids another stacked overriding repository.
export { TypeOrmEventingRepository as SafeTypeOrmEventingRepository } from './typeorm-eventing.repository';
export { unwrapTypeOrmMutationRows } from './typeorm-mutation-result';
