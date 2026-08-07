import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * @Global : la persistance sera utilisee par presque tous les modules metier
 * a venir (demandes, pieces, journal d'acces). Les faire tous importer
 * PrismaModule n'apporterait aucune information, seulement du bruit.
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
